/** @jest-environment node */
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  analyzeEmailAutomation,
  createApplicationFromEmail,
  createContactFromEmail,
  listAuditLogForUser,
  runEmailAutomation,
  updatePipelineFromEmail,
} from './emailAutomationService.js';

describe('emailAutomationService', () => {
  it('analyzes email and suggests creating application when no match', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const emailId = seedInboundEmail(db, {
      id: 'email-outreach',
      toEmail: 'seeker@example.com',
      fromEmail: 'recruiter@newco.com',
      classification: 'Recruiter Outreach',
      classificationConfidence: 65,
      companyName: 'NewCo',
      positionTitle: 'Backend Engineer',
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const analysis = analyzeEmailAutomation(db, userId, emailId);
    expect(analysis).not.toBeNull();
    expect(analysis!.canCreateApplication).toBe(true);
    expect(analysis!.matches.matches).toHaveLength(0);
    expect(analysis!.nextActions.some((a) => a.type === 'create_application')).toBe(
      true,
    );
  });

  it('offers—but does not auto-create—a confirmation with company but no role', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const emailId = seedInboundEmail(db, {
      id: 'email-valon',
      toEmail: 'seeker@example.com',
      fromEmail: 'no-reply@ashbyhq.com',
      subject: 'Thank you for applying to Valon',
      classification: 'Application Confirmation',
      classificationConfidence: 85,
      companyName: null,
      positionTitle: null,
      processedAt: '2026-07-06T07:44:00.000Z',
    });

    const analysis = analyzeEmailAutomation(db, userId, emailId)!;
    // Company (Valon) is identified from the subject, so a human is offered
    // creation...
    expect(analysis.canOfferApplicationCreation).toBe(true);
    // ...but with no role the STRICT auto-create gate stays closed (anti-junk).
    expect(analysis.canCreateApplication).toBe(false);
    expect(analysis.nextActions.some((a) => a.type === 'create_application')).toBe(true);

    // Strict (automatic) creation refuses without a role.
    expect(createApplicationFromEmail(db, userId, emailId)!.success).toBe(false);

    // Human-confirmed creation (allowMissingRole) succeeds as "Valon / Unknown role".
    const human = createApplicationFromEmail(db, userId, emailId, {
      allowMissingRole: true,
    });
    expect(human!.success).toBe(true);
    expect(human!.changes.applicationId).toBeTruthy();
  });

  it('Run all creates a company-known/role-missing confirmation app, then dedupes', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const emailId = seedInboundEmail(db, {
      id: 'email-valon-run',
      toEmail: 'seeker@example.com',
      fromEmail: 'no-reply@ashbyhq.com',
      subject: 'Thank you for applying to Valon',
      classification: 'Application Confirmation',
      classificationConfidence: 85,
      companyName: null,
      positionTitle: null,
      processedAt: '2026-07-06T07:44:00.000Z',
    });

    // "Run all" (human-confirmed) creates the Valon application.
    const run = runEmailAutomation(db, userId, emailId, {});
    const created = run!.results.find(
      (r) => r.actionType === 'create_application' && r.success,
    );
    expect(created).toBeTruthy();
    expect(created!.changes.applicationId).toBeTruthy();

    // Re-running does not create a second Valon entry (dedupe).
    const run2 = runEmailAutomation(db, userId, emailId, {});
    expect(
      run2!.results.some((r) => r.actionType === 'create_application' && r.success),
    ).toBe(false);
  });

  it('creates application and prevents duplicates', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, {
      id: 'existing',
      company: 'NewCo',
      roleTitle: 'Backend Engineer',
    });

    const emailId = seedInboundEmail(db, {
      classification: 'Recruiter Outreach',
      classificationConfidence: 65,
      companyName: 'NewCo',
      positionTitle: 'Backend Engineer',
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const result = createApplicationFromEmail(db, userId, emailId);
    expect(result!.success).toBe(false);
    expect(result!.changes.duplicateApplicationId).toBe('existing');
  });

  it('creates contact and logs communication', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, {
      id: 'app-contact',
      company: 'Acme',
      roleTitle: 'Engineer',
    });
    const emailId = seedInboundEmail(db, {
      id: 'email-contact',
      fromEmail: 'recruiter@acme.com',
      classification: 'Interview Request',
      classificationConfidence: 85,
      companyName: 'Acme',
      positionTitle: 'Engineer',
      recruiterName: 'Sam Recruiter',
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const result = createContactFromEmail(db, userId, emailId, appId);
    expect(result!.success).toBe(true);
    expect(result!.changes.contactId).toBeTruthy();
    expect(result!.changes.communicationId).toBeTruthy();
  });

  it('queues low-confidence pipeline updates for approval', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, {
      id: 'app-pipeline',
      company: 'Acme',
      roleTitle: 'Engineer',
      status: 'applied',
    });
    const emailId = seedInboundEmail(db, {
      id: 'email-pipeline',
      fromEmail: 'recruiter@acme.com',
      classification: 'Recruiter Outreach',
      classificationConfidence: 60,
      companyName: 'Acme',
      positionTitle: 'Engineer',
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const result = updatePipelineFromEmail(db, userId, emailId, {
      applicationId: appId,
    });
    expect(result!.success).toBe(true);
    expect(result!.pendingApprovalId).toBeTruthy();
    expect(result!.message).toMatch(/approval/i);
  });

  it('runs end-to-end automation for matched email', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, {
      id: 'app-run',
      company: 'Acme Corp',
      roleTitle: 'Software Engineer',
      status: 'applied',
    });
    const emailId = seedInboundEmail(db, {
      id: 'email-run',
      fromEmail: 'recruiter@acme.com',
      classification: 'Interview Request',
      classificationConfidence: 90,
      companyName: 'Acme Corp',
      positionTitle: 'Software Engineer',
      interviewDetected: true,
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const run = runEmailAutomation(db, userId, emailId, {
      applicationId: appId,
      force: true,
    });
    expect(run).not.toBeNull();
    expect(run!.results.length).toBeGreaterThan(0);

    const audit = listAuditLogForUser(db, userId);
    expect(audit.some((a) => a.actionType === 'run_automation')).toBe(true);
  });
});
