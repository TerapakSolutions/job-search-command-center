/** @jest-environment node */
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  listPendingApprovalsForUser,
  queueProcessingApproval,
  resolvePendingApproval,
} from './emailAutomationService.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import { emailAutomationAuditLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('explainable approval workflow', () => {
  it('stores structured approval details when queueing approval', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const emailId = seedInboundEmail(db, {
      id: 'email-approval',
      classification: 'Offer',
      classificationConfidence: 60,
      companyName: 'Acme',
      positionTitle: 'Engineer',
      suggestedAction: 'Review offer terms',
      processedAt: '2026-07-01T10:00:00.000Z',
    });
    seedApplication(db, userId, { id: 'app-offer', company: 'Acme', roleTitle: 'Engineer' });

    applySafeAutomationRules(db, userId, emailId);

    const pending = listPendingApprovalsForUser(db, userId);
    expect(pending.length).toBeGreaterThan(0);
    const approval = pending[0];
    expect(approval.approvalType).toBe('offer_detected');
    expect(approval.reasonMessage).toBeTruthy();
    expect(approval.suggestedAction).toBeTruthy();
    expect(approval.stopReason).toBeTruthy();
    expect(approval.autoApprovalThreshold).toBe(75);
  });

  it('records user decision trail in audit log on resolve', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const emailId = seedInboundEmail(db, {
      id: 'email-resolve',
      processedAt: '2026-07-01T10:00:00.000Z',
    });
    const appId = seedApplication(db, userId, {
      id: 'app-resolve',
      status: 'interviewing',
    });

    const approvalId = queueProcessingApproval(db, {
      userId,
      inboundEmailId: emailId,
      approvalType: 'pipeline_update',
      applicationId: appId,
      proposedStatus: 'offer',
      currentStatus: 'interviewing',
      confidence: 55,
      reason: 'offer',
      reasonCodes: ['offer'],
      suggestedAction: 'Move pipeline to offer after review',
    });

    resolvePendingApproval(db, userId, approvalId, 'approved');

    const auditRows = db
      .select()
      .from(emailAutomationAuditLog)
      .where(eq(emailAutomationAuditLog.inboundEmailId, emailId))
      .all();
    const decisionEntry = auditRows.find((row) => {
      const details = JSON.parse(row.detailsJson) as Record<string, unknown>;
      return details.userDecision === 'approved';
    });
    expect(decisionEntry).toBeTruthy();
    const details = JSON.parse(decisionEntry!.detailsJson) as Record<string, unknown>;
    expect(details.reasonCode).toBe('offer');
    expect(details.suggestedAction).toMatch(/offer/i);
    expect(details.confidence).toBe(55);
  });
});
