import type { Application, PipelineStatus } from '../types/application';
import { PIPELINE_STATUSES } from '../types/application';

// Positive milestones worth celebrating, in ascending pipeline order.
export const MILESTONE_STATUSES: PipelineStatus[] = [
  'interviewing',
  'final_round',
  'offer',
];

const MILESTONE_LABELS: Record<string, string> = {
  interviewing: 'Interview scheduled',
  final_round: 'Final round reached',
  offer: 'Offer received',
};

export interface Milestone {
  applicationId: string;
  company: string;
  roleTitle: string;
  status: PipelineStatus;
  label: string;
}

/** Map of applicationId -> last-seen status (persisted client-side). */
export type LastSeenStatusMap = Record<string, string>;

function statusIndex(status: string | undefined): number {
  return status === undefined ? -1 : PIPELINE_STATUSES.indexOf(status as PipelineStatus);
}

export function isMilestoneStatus(status: string): status is PipelineStatus {
  return (MILESTONE_STATUSES as string[]).includes(status);
}

export function currentStatusMap(applications: Application[]): LastSeenStatusMap {
  const map: LastSeenStatusMap = {};
  for (const app of applications) map[app.id] = app.status;
  return map;
}

/**
 * Applications that have *newly* advanced into a milestone status since the
 * last-seen snapshot. Fires only on forward movement into a milestone (a
 * higher pipeline index than before), so it ignores no-op reloads of apps
 * already in that state and backward moves (e.g. offer -> interviewing).
 */
export function detectNewMilestones(
  applications: Application[],
  lastSeen: LastSeenStatusMap,
): Milestone[] {
  const milestones: Milestone[] = [];
  for (const app of applications) {
    if (!isMilestoneStatus(app.status)) continue;
    if (statusIndex(lastSeen[app.id]) >= statusIndex(app.status)) continue;
    milestones.push({
      applicationId: app.id,
      company: app.company,
      roleTitle: app.roleTitle,
      status: app.status,
      label: MILESTONE_LABELS[app.status] ?? 'Milestone reached',
    });
  }
  return milestones;
}

/** The most advanced milestone to surface when several fire at once. */
export function topMilestone(milestones: Milestone[]): Milestone | null {
  if (milestones.length === 0) return null;
  return milestones.reduce((best, m) =>
    statusIndex(m.status) > statusIndex(best.status) ? m : best,
  );
}
