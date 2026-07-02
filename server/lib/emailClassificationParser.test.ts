/** @jest-environment node */
import {
  classifyInboundEmailWithRules,
} from './emailClassificationEngine.js';
import {
  defaultSuggestedAction,
  parseClassificationJson,
} from './emailClassificationParser.js';

describe('parseClassificationJson', () => {
  it('parses valid LLM JSON', () => {
    const result = parseClassificationJson(
      JSON.stringify({
        classification: 'Interview Request',
        classificationConfidence: 0.92,
        companyName: 'Acme Corp',
        positionTitle: 'Engineer',
        recruiterName: 'Jane',
        requiresResponse: true,
        suggestedAction: 'Reply to schedule',
        actionDueAt: '2026-07-03T17:00:00.000Z',
        interviewDetected: true,
        interviewDatetime: '2026-07-05T14:00:00.000Z',
        aiSummary: 'Interview requested.',
      }),
    );

    expect(result).toMatchObject({
      classification: 'Interview Request',
      classificationConfidence: 92,
      companyName: 'Acme Corp',
      requiresResponse: true,
      interviewDetected: true,
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parseClassificationJson('not json')).toBeNull();
  });

  it('normalizes unknown classifications to Other', () => {
    const result = parseClassificationJson(
      JSON.stringify({ classification: 'Mystery Type' }),
    );
    expect(result?.classification).toBe('Other');
  });
});

describe('defaultSuggestedAction', () => {
  it('returns action text for known classifications', () => {
    expect(defaultSuggestedAction('Rejection')).toContain('Archive');
    expect(defaultSuggestedAction('Interview Request')).toContain('schedule');
  });
});

describe('classifyInboundEmailWithRules', () => {
  it('classifies interview request emails', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'Next steps',
      fromEmail: 'recruiter@acme.com',
      textBody:
        'We reviewed your resume and want to schedule an interview for the engineering role.',
    });
    expect(result.classification).toBe('Interview Request');
    expect(result.requiresResponse).toBe(true);
    expect(result.interviewDetected).toBe(true);
  });

  it('classifies application confirmation emails', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'Application received',
      fromEmail: 'jobs@corp.com',
      textBody: 'Thank you for applying to the Software Engineer position.',
    });
    expect(result.classification).toBe('Application Confirmation');
    expect(result.requiresResponse).toBe(false);
  });

  it('classifies rejection emails', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'Update on your application',
      fromEmail: 'hr@startup.io',
      textBody:
        'We decided to move forward with other candidates for this role.',
    });
    expect(result.classification).toBe('Rejection');
    expect(result.suggestedAction).toContain('Archive');
  });

  it('classifies Pathstream interview confirmation with employer and role extraction', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'Pathstream | Interview Confirmation for Engineering Manager',
      fromEmail: 'jhardin@pathstream.com',
      textBody:
        'Your interview with Pathstream for the Engineering Manager position is confirmed for July 5, 2026 at 2:00 PM PT.',
    });

    expect(result.classification).toBe('Scheduling');
    expect(result.classificationConfidence).toBeGreaterThanOrEqual(75);
    expect(result.companyName).toBe('Pathstream');
    expect(result.positionTitle).toBe('Engineering Manager');
    expect(result.interviewDetected).toBe(true);
    expect(result.interviewDatetime).toMatch(/^2026-07-05/);
  });
});
