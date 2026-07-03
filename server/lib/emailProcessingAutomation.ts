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
  upsertInterviewFromEmail,
} from './emailAutomationService.js';
import type { AutomationActionResult } from './emailAutomationTypes.js';
import { PIPELINE_AUTO_CONFIDENCE_THRESHOLD } from './emailAutomationTypes.js';
import type { EmailAutomationAnalysis } from './emailAutomationTypes.js';
import {
  formatApprovalReason,
  formatPipelineApprovalLabel,
  hasIdentifiedCompanyAndRole,
  isNoReplyOrApplicationConfirmation,
} from './emailAutomationMessages.js';
import { isInterviewConfirmationText } from './emailContentExtraction.js';
import { formatAutomationActionMessage } from './automationOutcomeMessages.js';
import { approvalTypeLabel } from './approvalReason.js';
import type { ProcessingTimelineBuilder } from './processingTimeline.js';

const PROTECTED_PIPELINE_STATUSES = new Set(['offer']);

function isLinkedInApplicationConfirmation(
  row: typeof inboundEmails.$inferSelect,
): boolean {
  const from = row.fromEmail.toLowerCase();
  const linkedInSender = from.includes('linkedin.com') || from.includes('linkedin');
  return linkedInSender && row.classification === 'Application Confirmation';
}

function isApplicationConfirmation(row: typeof inboundEmails.$inferSelect): boolean {
  return row.classification === 'Application Confirmation';
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
  if (row.classification === 'Interview Request') return true;
  if (row.classification === 'Scheduling') {
    const haystack = `${row.originalSubject ?? row.subject}\n${row.aiSummary ?? ''}`;
    return !isInterviewConfirmationText(haystack);
  }
  return row.interviewDetected === true && row.classification !== 'Scheduling';
}

function isHighConfidence(row: typeof inboundEmails.$inferSelect): boolean {
  return (row.classificationConfidence ?? 0) >= PIPELINE_AUTO_CONFIDENCE_THRESHOLD;
}

function extractTextBody(payloadJson: string): string {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload.TextBody === 'string' ? payload.TextBody : '';
  } catch {
    return '';
  }
}

function hasRecruiterSignal(row: typeof inboundEmails.$inferSelect): boolean {
  if (row.recruiterName?.trim()) return true;
  const from = row.fromEmail.toLowerCase();
  if (
    from.includes('noreply') ||
    from.includes('no-reply') ||
    from.includes('donotreply') ||
    from.includes('notifications@')
  ) {
    return false;
  }
  return !isApplicationConfirmation(row);
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
  options: {
    skipCompletedActions?: boolean;
    timeline?: ProcessingTimelineBuilder;
  } = {},
): {
  results: AutomationActionResult[];
  pendingApprovals: number;
  riskyReasons: string[];
  skipSummary?: string;
  approvalSummary?: string;
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
    return {
      results: [],
      pendingApprovals: 0,
      riskyReasons: [],
      skipSummary: 'Skipped pipeline update: no matched application',
    };
  }

  const riskyReasons = collectRiskyApprovalReasons(row, analysis);
  const results: AutomationActionResult[] = [];
  const skipReasons: string[] = [];
  let pendingApprovals = 0;
  const approvalMessages: string[] = [];
  const skipCompleted = options.skipCompletedActions ?? false;

  const shouldSkip = (actionType: AutomationActionResult['actionType']) =>
    skipCompleted && hasCompletedAutomationAction(db, emailId, actionType);

  const applicationId =
    analysis.matches.bestMatch?.applicationId ??
    analysis.duplicateApplicationId ??
    undefined;

  const textBody = extractTextBody(row.payload);

  if (
    isApplicationConfirmation(row) &&
    isHighConfidence(row) &&
    !shouldSkip('create_application')
  ) {
    if (applicationId) {
      const match = analysis.matches.bestMatch;
      const pipelineResult = updatePipelineFromEmail(db, userId, emailId, {
        applicationId,
        status: 'applied',
        force: true,
      });
      if (pipelineResult) {
        results.push({
          ...pipelineResult,
          message: match
            ? `Matched existing application: ${match.company} / ${match.roleTitle}`
            : pipelineResult.message,
        });
      }
    } else if (!analysis.duplicateApplicationId) {
      if (
        hasIdentifiedCompanyAndRole({
          companyName: row.companyName,
          originalCompany: row.originalCompany,
          positionTitle: row.positionTitle,
          subject: row.originalSubject ?? row.subject,
          senderEmail: row.originalSenderEmail ?? row.fromEmail,
        })
      ) {
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
      } else {
        const approvalId = queueProcessingApproval(db, {
          userId,
          inboundEmailId: emailId,
          approvalType: 'create_application_suggestion',
          proposedStatus: 'applied',
          confidence: row.classificationConfidence ?? 50,
          reason: 'insufficient_company_role_extraction',
          reasonCodes: ['insufficient_company_role_extraction', 'no_application_match'],
          suggestedAction:
            'Identify the company and role from this confirmation before creating an application',
        });
        pendingApprovals += 1;
        approvalMessages.push(approvalTypeLabel('no_matching_application'));
        recordEmailAutomationAudit(db, {
          userId,
          inboundEmailId: emailId,
          actionType: 'create_application',
          confidence: row.classificationConfidence,
          status: 'pending',
          details: {
            pendingApprovalId: approvalId,
            type: 'create_application_suggestion',
            reasonCode: 'insufficient_company_role_extraction',
            suggestedAction:
              'Identify the company and role from this confirmation before creating an application',
          },
        });
        skipReasons.push(
          'Skipped application creation: company and role not identified',
        );
      }
    } else {
      skipReasons.push('Skipped application creation: duplicate found');
    }
  } else if (isLinkedInApplicationConfirmation(row) && !shouldSkip('create_application')) {
    if (applicationId) {
      const pipelineResult = updatePipelineFromEmail(db, userId, emailId, {
        applicationId,
        status: 'applied',
        force: true,
      });
      if (pipelineResult) results.push(pipelineResult);
    } else if (
      hasIdentifiedCompanyAndRole({
        companyName: row.companyName,
        originalCompany: row.originalCompany,
        positionTitle: row.positionTitle,
        subject: row.originalSubject ?? row.subject,
        senderEmail: row.originalSenderEmail ?? row.fromEmail,
      })
    ) {
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
    } else {
      skipReasons.push(
        'Skipped application creation: company and role not identified',
      );
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
  } else if (
    row.classification === 'Rejection' &&
    !applicationId
  ) {
    skipReasons.push('Skipped pipeline update: no matched application');
  }

  if (
    row.classification === 'Scheduling' &&
    isHighConfidence(row) &&
    applicationId &&
    !analysis.matches.requiresManualSelection &&
    !shouldSkip('update_pipeline')
  ) {
    const match = analysis.matches.bestMatch;
    const pipelineResult = updatePipelineFromEmail(db, userId, emailId, {
      applicationId,
      force: true,
    });
    if (pipelineResult) {
      results.push({
        ...pipelineResult,
        message: match
          ? `Matched existing application: ${match.company} / ${match.roleTitle}`
          : pipelineResult.message,
      });
    }
  }

  // Gated independently from the update_pipeline check above (own
  // shouldSkip('create_interview') key), not nested inside it. Nesting this
  // under update_pipeline's gate meant that once update_pipeline completed on
  // any prior run, every later reanalysis short-circuited before ever
  // attempting interview creation -- even after interviewDatetime newly became
  // available (e.g. from a classification/extraction fix). See issue #11.
  if (
    row.classification === 'Scheduling' &&
    isHighConfidence(row) &&
    applicationId &&
    !analysis.matches.requiresManualSelection &&
    row.interviewDatetime &&
    !shouldSkip('create_interview')
  ) {
    const interviewResult = upsertInterviewFromEmail(
      db,
      userId,
      emailId,
      applicationId,
    );
    if (interviewResult) results.push(interviewResult);
  }

  // Interview Request emails create/update an interview record only when they
  // carry a concrete date/time AND meet the same high-confidence + confident-match
  // gates as Scheduling. Date-less, low-confidence, or ambiguous-match Interview
  // Requests fall through to the existing risky -> pending-approval routing below
  // (Interview Request is always flagged risky by isInterviewScheduling). This
  // reuses upsertInterviewFromEmail (shared record write + dedupe), so it never
  // creates a duplicate when the same email is reprocessed or a later Scheduling
  // email references the same application/day.
  if (
    row.classification === 'Interview Request' &&
    isHighConfidence(row) &&
    applicationId &&
    !analysis.matches.requiresManualSelection &&
    row.interviewDatetime &&
    !shouldSkip('create_interview')
  ) {
    const interviewResult = upsertInterviewFromEmail(
      db,
      userId,
      emailId,
      applicationId,
    );
    if (interviewResult) results.push(interviewResult);
  }

  if (
    (row.classification === 'Scheduling' || row.classification === 'Interview Request') &&
    isHighConfidence(row) &&
    applicationId &&
    !shouldSkip('create_contact')
  ) {
    if (hasRecruiterSignal(row)) {
      const contactResult = createContactFromEmail(db, userId, emailId, applicationId);
      if (contactResult) results.push(contactResult);
    } else {
      skipReasons.push('Skipped contact creation: no recruiter detected');
    }
  }

  if (
    row.classification === 'Application Confirmation' &&
    isHighConfidence(row) &&
    applicationId &&
    !shouldSkip('create_contact')
  ) {
    if (hasRecruiterSignal(row)) {
      const contactResult = createContactFromEmail(db, userId, emailId, applicationId);
      if (contactResult) results.push(contactResult);
    } else {
      skipReasons.push('Skipped contact creation: no recruiter detected');
    }
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
        reason: 'no_application_match',
        reasonCodes: ['no_application_match'],
        suggestedAction: `Create application for ${row.companyName ?? 'this company'} / ${row.positionTitle ?? 'role from email'}`,
      });
      pendingApprovals += 1;
      approvalMessages.push(approvalTypeLabel('no_matching_application'));
      recordEmailAutomationAudit(db, {
        userId,
        inboundEmailId: emailId,
        actionType: 'match_applications',
        confidence: row.classificationConfidence,
        status: 'pending',
        details: {
          pendingApprovalId: approvalId,
          type: 'create_application_suggestion',
          reasonCode: 'no_application_match',
          suggestedAction: `Create application for ${row.companyName ?? 'this company'}`,
        },
      });
    } else if (analysis.duplicateApplicationId) {
      const approvalId = queueProcessingApproval(db, {
        userId,
        inboundEmailId: emailId,
        approvalType: 'link_application',
        applicationId: analysis.duplicateApplicationId,
        proposedStatus: 'recruiter_screen',
        confidence: row.classificationConfidence ?? 50,
        reason: 'duplicate_application_ambiguous',
        reasonCodes: ['duplicate_application_ambiguous', 'ambiguous_application_match'],
        suggestedAction: 'Link this email to the existing application and update pipeline',
        candidateMatches: analysis.matches.matches,
      });
      pendingApprovals += 1;
      approvalMessages.push(approvalTypeLabel('multiple_matching_applications'));
      recordEmailAutomationAudit(db, {
        userId,
        inboundEmailId: emailId,
        actionType: 'match_applications',
        confidence: row.classificationConfidence,
        status: 'pending',
        details: {
          pendingApprovalId: approvalId,
          type: 'link_application',
          reasonCode: 'ambiguous_application_match',
          candidateMatches: analysis.matches.matches,
        },
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
      reasonCodes: riskyReasons,
      suggestedAction: `Update pipeline to ${analysis.pipelineProposal.proposedStatus.replace(/_/g, ' ')}`,
      candidateMatches: analysis.matches.matches,
    });
    pendingApprovals += 1;
    approvalMessages.push(
      formatPipelineApprovalLabel(
        analysis.pipelineProposal.proposedStatus,
        analysis.pipelineProposal.currentStatus,
      ),
    );
    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'update_pipeline',
      confidence: row.classificationConfidence,
      status: 'pending',
      details: {
        pendingApprovalId: approvalId,
        riskyReasons,
        reasonCode: riskyReasons[0],
        suggestedAction: `Update pipeline to ${analysis.pipelineProposal.proposedStatus.replace(/_/g, ' ')}`,
        confidence: row.classificationConfidence,
      },
    });
  }

  const suppressReply = isNoReplyOrApplicationConfirmation({
    fromEmail: row.originalSenderEmail ?? row.fromEmail,
    classification: row.classification,
    subject: row.originalSubject ?? row.subject,
    textBody,
  });

  if (row.requiresResponse && !suppressReply) {
    const approvalId = queueProcessingApproval(db, {
      userId,
      inboundEmailId: emailId,
      approvalType: 'draft_reply',
      proposedStatus: 'saved',
      confidence: row.classificationConfidence ?? 50,
      reason: 'requires_response',
      reasonCodes: ['requires_response'],
      suggestedAction: row.suggestedAction ?? 'Review and send a reply to this email',
    });
    pendingApprovals += 1;
    approvalMessages.push(approvalTypeLabel('manual_review_required'));
    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'draft_reply',
      confidence: row.classificationConfidence,
      status: 'pending',
      details: {
        pendingApprovalId: approvalId,
        reasonCode: 'requires_response',
        suggestedAction: row.suggestedAction,
        confidence: row.classificationConfidence,
      },
    });
  } else if (row.requiresResponse && suppressReply) {
    skipReasons.push(formatAutomationActionMessage({
      actionType: 'draft_reply',
      success: false,
      detail: 'no-reply/application confirmation',
    }));
  }

  if (
    row.classification === 'Recruiter Outreach' &&
    isHighConfidence(row) &&
    !applicationId &&
    !analysis.canCreateApplication &&
    !shouldSkip('create_contact')
  ) {
    const approvalId = queueProcessingApproval(db, {
      userId,
      inboundEmailId: emailId,
      approvalType: 'create_contact',
      proposedStatus: 'saved',
      confidence: row.classificationConfidence ?? 50,
      reason: 'recruiter_without_application',
      reasonCodes: ['recruiter_without_application', 'no_application_match'],
      suggestedAction: 'Create recruiter contact and optionally link to a new application',
    });
    pendingApprovals += 1;
    approvalMessages.push(approvalTypeLabel('no_matching_application'));
    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'create_contact',
      confidence: row.classificationConfidence,
      status: 'pending',
      details: {
        pendingApprovalId: approvalId,
        type: 'create_contact',
        reasonCode: 'recruiter_without_application',
        suggestedAction: 'Create recruiter contact',
      },
    });
  }

  return {
    results,
    pendingApprovals,
    riskyReasons,
    skipSummary: skipReasons.length > 0 ? skipReasons.join('; ') : undefined,
    approvalSummary:
      approvalMessages.length > 0
        ? approvalMessages.join('; ')
        : pendingApprovals > 0
          ? formatApprovalReason(riskyReasons.join(', '))
          : undefined,
  };
}
