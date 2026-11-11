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

/**
 * Map of applicationId -> last-seen "status" or "status@interviewDate"
 * (persisted client-side).
 */
export type LastSeenStatusMap = Record<string, string>;

function seenValue(app: Application): string {
  return app.interviewDate ? `${app.status}@${app.interviewDate}` : app.status;
}

function parseSeen(value: string | undefined): { status: string | undefined; date: string } {
  if (value === undefined) return { status: undefined, date: '' };
  const at = value.indexOf('@');
  return at < 0
    ? { status: value, date: '' }
    : { status: value.slice(0, at), date: value.slice(at + 1) };
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Interviewing is only "Interview scheduled" once an interview is booked for
// today or later. A screening request, an undated interview request, or a
// past date left over from an earlier screening is not a milestone yet.
function isCelebratable(app: Application, today: string): boolean {
  if (!isMilestoneStatus(app.status)) return false;
  if (app.status !== 'interviewing') return true;
  return Boolean(app.interviewDate) && app.interviewDate! >= today;
}

function statusIndex(status: string | undefined): number {
  return status === undefined ? -1 : PIPELINE_STATUSES.indexOf(status as PipelineStatus);
}

export function isMilestoneStatus(status: string): status is PipelineStatus {
  return (MILESTONE_STATUSES as string[]).includes(status);
}

export function currentStatusMap(applications: Application[]): LastSeenStatusMap {
  const map: LastSeenStatusMap = {};
  for (const app of applications) map[app.id] = seenValue(app);
  return map;
}

/**
 * Applications that have *newly* reached a milestone since the last-seen
 * snapshot: forward movement into a milestone status (a higher pipeline index
 * than before), or an Interviewing application whose interview date has just
 * appeared. Ignores no-op reloads, reschedules, and backward moves (e.g.
 * offer -> interviewing).
 */
export function detectNewMilestones(
  applications: Application[],
  lastSeen: LastSeenStatusMap,
  today: string = localToday(),
): Milestone[] {
  const milestones: Milestone[] = [];
  for (const app of applications) {
    if (!isCelebratable(app, today)) continue;
    const seen = parseSeen(lastSeen[app.id]);
    const advanced = statusIndex(seen.status) < statusIndex(app.status);
    // Still Interviewing, and a booked date replaced none or a past one
    // (a reschedule from one upcoming date to another doesn't count).
    const dateArrived =
      seen.status === app.status &&
      app.status === 'interviewing' &&
      seen.date !== app.interviewDate &&
      (!seen.date || seen.date < today);
    if (!advanced && !dateArrived) continue;
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
