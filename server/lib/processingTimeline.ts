export const PROCESSING_TIMELINE_STEPS = [
  'received',
  'persisted',
  'classified',
  'application_matched',
  'automation_evaluated',
  'safe_actions_applied',
  'approval_queued',
  'audit_logged',
  'processing_completed',
  'processing_failed',
] as const;

export type ProcessingTimelineStepId = (typeof PROCESSING_TIMELINE_STEPS)[number];

export type ProcessingTimelineStepStatus =
  | 'pending'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface ProcessingTimelineStep {
  step: ProcessingTimelineStepId;
  status: ProcessingTimelineStepStatus;
  timestamp: string | null;
  message: string;
  error?: string | null;
}

export interface ProcessingTimeline {
  steps: ProcessingTimelineStep[];
}

export class ProcessingTimelineBuilder {
  private steps: ProcessingTimelineStep[] = [];

  private upsert(
    step: ProcessingTimelineStepId,
    update: Partial<Omit<ProcessingTimelineStep, 'step'>>,
  ): void {
    const existing = this.steps.find((s) => s.step === step);
    if (existing) {
      Object.assign(existing, update);
      return;
    }
    this.steps.push({
      step,
      status: 'pending',
      timestamp: null,
      message: '',
      ...update,
    });
  }

  complete(step: ProcessingTimelineStepId, message: string, timestamp: string): void {
    this.upsert(step, { status: 'completed', message, timestamp, error: null });
  }

  skip(step: ProcessingTimelineStepId, message: string, timestamp: string): void {
    this.upsert(step, { status: 'skipped', message, timestamp, error: null });
  }

  fail(
    step: ProcessingTimelineStepId,
    message: string,
    error: string,
    timestamp: string,
  ): void {
    this.upsert(step, { status: 'failed', message, error, timestamp });
  }

  toJson(): string {
    return JSON.stringify({ steps: this.steps } satisfies ProcessingTimeline);
  }

  static parse(raw: string | null | undefined): ProcessingTimeline | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ProcessingTimeline;
      if (!Array.isArray(parsed.steps)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

export const PROCESSING_TIMELINE_LABELS: Record<ProcessingTimelineStepId, string> = {
  received: 'Received',
  persisted: 'Persisted',
  classified: 'Classified',
  application_matched: 'Application matched',
  automation_evaluated: 'Automation evaluated',
  safe_actions_applied: 'Safe actions applied',
  approval_queued: 'Approval queued',
  audit_logged: 'Audit logged',
  processing_completed: 'Processing completed',
  processing_failed: 'Processing failed',
};
