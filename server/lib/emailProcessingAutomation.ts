import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { inboundEmails } from '../db/schema.js';
import {
  analyzeEmailAutomation,
  createApplicationFromEmail,
  createContactFromEmail,
  hasCompletedAutomationAction,
  queueProcessingApproval,
  recordEmailAutomationAudit,
  updatePipelineFromEmail,
} from './emailAutomationService.js';
import type { AutomationActionResult } from './emailAutomationTypes.js';
import { PIPELINE_AUTO_CONFIDENCE_THRESHOLD } from './emailAutomationTypes.js';
import type { EmailAutomationAnalysis } from './emailAutomationTypes.js';

const PROTECTED_PIPELINE_STATUSES = new Set(['offer']);

function isLinkedInApplicationConfirmation(
  row: typeof inboundEmails.$inferSelect,
): boolean {
  const from = row.fromEmail.toLowerCase();
  const linkedInSender = from.includes('linkedin.com') || from.includes('linkedin');
  return linkedInSender && row.classification === 'Application Confirmation';
}

function isSalaryNegotiation(row: typeof inboundEmails.$inferSelect): boolean {
  if (row.classification === 'Offer') return true;
  const haystack = `${row.subject} ${row.aiSummary ?? ''}`.toLowerCase();
  return (
    haystack.includes('salary') ||
    haystack.includes('compensation') ||
    haystack.includes('negotiat')
  );
}

function isInterviewScheduling(row: typeof inboundEmails.$inferSelect): boolean {
  return (
    row.classification === 'Interview Request' ||
    row.classification === 'Scheduling' ||
    row.interviewDetected === true
  );
}

function isHighConfidence(row: typeof inboundEmails.$inferSelect): boolean {
  return (row.classificationConfidence ?? 0) >= PIPELINE_AUTO_CONFIDENCE_THRESHOLD;
}

export function collectRiskyApprovalReasons(
  row: typeof inboundEmails.$inferSelect,
  analysis: EmailAutomationAnalysis,
): string[] {
  const reasons: string[] = [];

  if (!isHighConfidence(row)) {
    reasons.push('low_confidence_classification');
  }
  if (analysis.matches.requiresManualSelection) {
    reasons.push('ambiguous_application_match');
  }
  if (row.classification === 'Offer') {
    reasons.push('offer');
  }
  if (isSalaryNegotiation(row)) {
    reasons.push('salary_negotiation');
  }
  if (isInterviewScheduling(row)) {
    reasons.push('interview_scheduling');
  }

  const appId =
    analysis.matches.bestMatch?.applicationId ??
    analysis.duplicateApplicationId ??
    null;
  if (appId && analysis.pipelineProposal) {
    const currentStatus = analysis.pipelineProposal.currentStatus;
    if (
      PROTECTED_PIPELINE_STATUSES.has(currentStatus) &&
      analysis.pipelineProposal.proposedStatus !== currentStatus
    ) {
      reasons.push('protected_pipeline_status');
    }
  }

  return reasons;
}

export function applySafeAutomationRules(
  db: Db,
  userId: string,
  emailId: string,
  options: { skipCompletedActions?: boolean } = {},
): {
  results: AutomationActionResult[];
  pendingApprovals: number;
  riskyReasons: string[];
} {
  const row = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, emailId))
    .limit(1)
    .all()[0];
  if (!row) {
    return { results: [], pendingApprovals: 0, riskyReasons: [] };
  }

  const analysis = analyzeEmailAutomation(db, userId, emailId);
  if (!analysis) {
    return { results: [], pendingApprovals: 0, riskyReasons: [] };
  }

  const riskyReasons = collectRiskyApprovalReasons(row, analysis);
  const results: AutomationActionResult[] = [];
  let pendingApprovals = 0;
  const skipCompleted = options.skipCompletedActions ?? false;

  const shouldSkip = (actionType: AutomationActionResult['actionType']) =>
    skipCompleted && hasCompletedAutomationAction(db, emailId, actionType);

  const applicationId =
    analysis.matches.bestMatch?.applicationId ??
    analysis.duplicateApplicationId ??
    undefined;

  if (isLinkedInApplicationConfirmation(row) && !shouldSkip('create_application')) {
    if (applicationId) {
      const pipelineResult = updatePipelineFromEmail(db, userId, emailId, {
        applicationId,
        status: 'applied',
        force: true,
      });
      if (pipelineResult) results.push(pipelineResult);
    } else {
      const createResult = createApplicationFromEmail(db, userId, emailId);
      if (createResult) {
        results.push(createResult);
        if (createResult.success && createResult.changes.applicationId) {
          const pipelineResult = updatePipelineFromEmail(db, userId, emailId, {
            applicationId: String(createResult.changes.applicationId),
            status: 'applied',
            force: true,
          });
          if (pipelineResult) results.push(pipelineResult);
        }
      }
    }
  }

  if (
    row.classification === 'Rejection' &&
    isHighConfidence(row) &&
    applicationId &&
    !analysis.matches.requiresManualSelection &&
    !shouldSkip('update_pipeline')
  ) {
    const pipelineResult = updatePipelineFromEmail(db, userId, emailId, {
      applicationId,
      status: 'rejected',
      force: true,
    });
    if (pipelineResult) results.push(pipelineResult);
  }

  if (
    row.classification === 'Application Confirmation' &&
    isHighConfidence(row) &&
    applicationId &&
    !shouldSkip('create_contact')
  ) {
    const contactResult = createContactFromEmail(db, userId, emailId, applicationId);
    if (contactResult) results.push(contactResult);
  }

  if (
    row.classification === 'Recruiter Outreach' &&
    isHighConfidence(row) &&
    !shouldSkip('create_contact')
  ) {
    if (applicationId) {
      const contactResult = createContactFromEmail(db, userId, emailId, applicationId);
      if (contactResult) results.push(contactResult);
    } else if (analysis.canCreateApplication) {
      const approvalId = queueProcessingApproval(db, {
        userId,
        inboundEmailId: emailId,
        approvalType: 'create_application_suggestion',
        proposedStatus: 'saved',
        confidence: row.classificationConfidence ?? 50,
        reason: 'High-confidence recruiter outreach suggests creating an application',
      });
      pendingApprovals += 1;
      recordEmailAutomationAudit(db, {
        userId,
        inboundEmailId: emailId,
        actionType: 'match_applications',
        confidence: row.classificationConfidence,
        status: 'pending',
        details: { pendingApprovalId: approvalId, type: 'create_application_suggestion' },
      });
    }
  }

  if (riskyReasons.length > 0 && analysis.pipelineProposal && applicationId) {
    const approvalId = queueProcessingApproval(db, {
      userId,
      inboundEmailId: emailId,
      approvalType: 'pipeline_update',
      applicationId,
      proposedStatus: analysis.pipelineProposal.proposedStatus,
      currentStatus: analysis.pipelineProposal.currentStatus,
      confidence: row.classificationConfidence ?? 50,
      reason: riskyReasons.join(', '),
    });
    pendingApprovals += 1;
    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'update_pipeline',
      confidence: row.classificationConfidence,
      status: 'pending',
      details: { pendingApprovalId: approvalId, riskyReasons },
    });
  }

  if (row.requiresResponse) {
    const approvalId = queueProcessingApproval(db, {
      userId,
      inboundEmailId: emailId,
      approvalType: 'draft_reply',
      proposedStatus: 'saved',
      confidence: row.classificationConfidence ?? 50,
      reason: 'Response may involve sending email',
    });
    pendingApprovals += 1;
    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'draft_reply',
      confidence: row.classificationConfidence,
      status: 'pending',
      details: { pendingApprovalId: approvalId, reason: 'requires_response' },
    });
  }

  return { results, pendingApprovals, riskyReasons };
}
