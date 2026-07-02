import type { ProcessingStatus, PendingApprovalSummary } from '../types/inboundEmail';
import { processingStatusWithApprovalLabel } from './approvalDisplay';

export function processingStatusLabel(
  status: ProcessingStatus,
  needsApproval: boolean,
  approvalItems?: PendingApprovalSummary[],
): string {
  if (status === 'processing') return 'Processing…';
  if (status === 'failed') return 'Failed';
  if (needsApproval) return processingStatusWithApprovalLabel(approvalItems);
  if (status === 'processed') return 'Processed';
  return 'Pending';
}

export function processingStatusBadgeClass(
  status: ProcessingStatus,
  needsApproval: boolean,
): string {
  if (status === 'processing') return 'bg-blue-100 text-blue-800 border-blue-200';
  if (status === 'failed') return 'bg-red-100 text-red-800 border-red-200';
  if (needsApproval) return 'bg-amber-100 text-amber-800 border-amber-200';
  if (status === 'processed') return 'bg-green-100 text-green-800 border-green-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}
