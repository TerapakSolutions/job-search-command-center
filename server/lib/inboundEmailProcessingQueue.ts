import type { Db } from '../db/index.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';

export type ProcessingOptions = Parameters<typeof processInboundEmail>[2];
export type ProcessingScheduler = (
  db: Db,
  emailId: string,
  options?: ProcessingOptions,
) => void;

let scheduler: ProcessingScheduler = (db, emailId, options) => {
  setImmediate(() => {
    void processInboundEmail(db, emailId, options).catch((err) => {
      console.error('[inbound-processing] background processing failed', {
        emailId,
        err,
      });
    });
  });
};

export function scheduleInboundEmailProcessing(
  db: Db,
  emailId: string,
  options?: ProcessingOptions,
): void {
  scheduler(db, emailId, options);
}

/** Test hook to replace background scheduling. */
export function setInboundEmailProcessingScheduler(next: ProcessingScheduler): void {
  scheduler = next;
}

export function resetInboundEmailProcessingScheduler(): void {
  scheduler = (db, emailId, options) => {
    setImmediate(() => {
      void processInboundEmail(db, emailId, options).catch((err) => {
        console.error('[inbound-processing] background processing failed', {
          emailId,
          err,
        });
      });
    });
  };
}
