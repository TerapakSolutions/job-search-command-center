/** @jest-environment jsdom */
import { processingStatusLabel } from './inboundEmailProcessing';

describe('inboundEmailProcessing labels', () => {
  it('uses approval-specific label instead of generic needs approval', () => {
    const label = processingStatusLabel('processed', true, [
      {
        id: 'approval-1',
        approvalType: 'offer_detected',
        label: 'Offer detected',
        reason: 'Offer requires manual review',
        reasonCode: 'offer',
        reasonMessage: 'An offer was detected — pipeline changes need your confirmation.',
        suggestedAction: 'Review offer and approve pipeline update',
        aiConfidence: 62,
        autoApprovalThreshold: 75,
        stopReason: 'An offer was detected',
        candidateMatches: [],
        proposedStatus: 'offer',
        currentStatus: 'interviewing',
      },
    ]);
    expect(label).toBe('Offer detected');
    expect(label).not.toMatch(/Needs approval/i);
  });
});
