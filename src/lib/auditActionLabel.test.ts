import { auditActionLabel } from './auditActionLabel';

const entry = (actionType: string, status: string, details: Record<string, unknown> = {}) => ({
  actionType,
  status,
  details,
});

describe('Recent AI actions labels (R4)', () => {
  it('gives the queued, approved and declined steps of one email distinct labels', () => {
    // The three rows one screening email left in prod.
    const labels = [
      entry('update_pipeline', 'pending', { pendingApprovalId: 'a1' }),
      entry('update_pipeline', 'completed', { approvalType: 'pipeline_update', userDecision: 'approved' }),
      entry('draft_reply', 'rejected', { approvalType: 'draft_reply', userDecision: 'rejected' }),
    ].map(auditActionLabel);

    expect(labels).toEqual(['pipeline update queued', 'pipeline updated', 'draft reply declined']);
  });

  it('a pipeline update the system skipped is not shown as declined', () => {
    expect(auditActionLabel(entry('update_pipeline', 'rejected', { reason: 'no_proposed_status' }))).toBe(
      'pipeline unchanged',
    );
    expect(
      auditActionLabel(
        entry('update_pipeline', 'rejected', { reason: 'stage_already_past', userDecision: 'approved' }),
      ),
    ).toBe('pipeline unchanged');
  });

  it('a pipeline update you declined says so', () => {
    expect(auditActionLabel(entry('update_pipeline', 'rejected', { userDecision: 'rejected' }))).toBe(
      'pipeline update declined',
    );
  });

  it('other actions keep their name, marked when queued or skipped', () => {
    expect(auditActionLabel(entry('create_contact', 'completed'))).toBe('create contact');
    expect(auditActionLabel(entry('draft_reply', 'pending'))).toBe('draft reply queued');
    expect(auditActionLabel(entry('create_contact', 'rejected'))).toBe('create contact skipped');
  });
});
