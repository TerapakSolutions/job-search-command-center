import type { AuditLogEntry } from '../types/emailAutomation';

type LabelInput = Pick<AuditLogEntry, 'actionType' | 'status' | 'details'>;

/**
 * What a Recent AI actions row says. One email can leave several rows for the
 * same action type (queued, then approved or declined), so the status is part
 * of the label. A row the system skipped is never shown as "declined": only a
 * rejection you made (userDecision "rejected") is.
 */
// The action an approval stands for. Rows written before declines were
// logged under their own type say update_pipeline whatever was declined, so
// the approval type on the row wins.
function actionTypeOf(entry: LabelInput): string {
  switch (entry.details?.approvalType) {
    case 'draft_reply':
      return 'draft_reply';
    case 'create_contact':
      return 'create_contact';
    case 'link_application':
      return 'match_applications';
    case 'create_application_suggestion':
      return 'create_application';
    case 'pipeline_update':
      return 'update_pipeline';
    default:
      return entry.actionType;
  }
}

export function auditActionLabel(entry: LabelInput): string {
  const declinedByYou = entry.details?.userDecision === 'rejected';
  const actionType = actionTypeOf(entry);

  if (actionType === 'update_pipeline') {
    if (entry.status === 'pending') return 'pipeline update queued';
    if (entry.status === 'rejected') {
      return declinedByYou ? 'pipeline update declined' : 'pipeline unchanged';
    }
    return 'pipeline updated';
  }

  const base = actionType.replace(/_/g, ' ');
  if (entry.status === 'pending') return `${base} queued`;
  if (entry.status === 'rejected') return declinedByYou ? `${base} declined` : `${base} skipped`;
  return base;
}
