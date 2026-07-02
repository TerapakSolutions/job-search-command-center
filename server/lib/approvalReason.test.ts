/** @jest-environment node */
import {
  approvalTypeLabel,
  buildApprovalReason,
  reasonCodeMessage,
  resolveApprovalType,
} from './approvalReason.js';

describe('approvalReason', () => {
  it('maps legacy approval types to explainable approval types', () => {
    expect(
      resolveApprovalType({
        legacyApprovalType: 'create_application_suggestion',
        reasonCodes: ['no_application_match'],
      }),
    ).toBe('no_matching_application');

    expect(
      resolveApprovalType({
        legacyApprovalType: 'pipeline_update',
        reasonCodes: ['offer'],
      }),
    ).toBe('offer_detected');

    expect(
      resolveApprovalType({
        legacyApprovalType: 'pipeline_update',
        reasonCodes: ['interview_scheduling'],
      }),
    ).toBe('interview_detected');
  });

  it('builds structured approval reason details', () => {
    const details = buildApprovalReason({
      legacyApprovalType: 'pipeline_update',
      reasonCodes: ['low_confidence_classification', 'offer'],
      aiConfidence: 62,
      suggestedAction: 'Review offer details before updating pipeline',
      candidateMatches: [
        {
          applicationId: 'app-1',
          company: 'Acme',
          roleTitle: 'Engineer',
          status: 'interviewing',
          confidence: 80,
          matchReasons: ['Company match'],
        },
      ],
    });

    expect(details.approvalType).toBe('offer_detected');
    expect(details.reasonCode).toBe('offer');
    expect(details.aiConfidence).toBe(62);
    expect(details.autoApprovalThreshold).toBe(75);
    expect(details.candidateMatches).toHaveLength(1);
    expect(details.stopReason).toContain('offer');
  });

  it('provides human-readable labels and messages', () => {
    expect(approvalTypeLabel('salary_negotiation_detected')).toBe(
      'Salary negotiation detected',
    );
    expect(reasonCodeMessage('ambiguous_application_match')).toMatch(
      /Multiple applications match/i,
    );
  });
});
