import type { AuditLogEntry } from '../types/emailAutomation';

type LabelInput = Pick<AuditLogEntry, 'actionType' | 'status' | 'details'>;

/**
 * What a Recent AI actions row says. One email can leave several rows for the
 * same action type (queued, then approved or declined), so the status is part
 * of the label. A row the system skipped is never shown as "declined": only a
 * rejection you made (userDecision "rejected") is.
 */
export function auditActionLabel(entry: LabelInput): string {
  const declinedByYou = entry.details?.userDecision === 'rejected';

  if (entry.actionType === 'update_pipeline') {
    if (entry.status === 'pending') return 'pipeline update queued';
    if (entry.status === 'rejected') {
      return declinedByYou ? 'pipeline update declined' : 'pipeline unchanged';
    }
    return 'pipeline updated';
  }

  const base = entry.actionType.replace(/_/g, ' ');
  if (entry.status === 'pending') return `${base} queued`;
  if (entry.status === 'rejected') return declinedByYou ? `${base} declined` : `${base} skipped`;
  return base;
}
