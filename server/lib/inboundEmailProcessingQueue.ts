import type { Db } from '../db/index.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';

export type ProcessingScheduler = (db: Db, emailId: string) => void;

let scheduler: ProcessingScheduler = (db, emailId) => {
  setImmediate(() => {
    void processInboundEmail(db, emailId).catch((err) => {
      console.error('[inbound-processing] background processing failed', {
        emailId,
        err,
      });
    });
  });
};

export function scheduleInboundEmailProcessing(db: Db, emailId: string): void {
  scheduler(db, emailId);
}

/** Test hook to replace background scheduling. */
export function setInboundEmailProcessingScheduler(next: ProcessingScheduler): void {
  scheduler = next;
}

export function resetInboundEmailProcessingScheduler(): void {
  scheduler = (db, emailId) => {
    setImmediate(() => {
      void processInboundEmail(db, emailId).catch((err) => {
        console.error('[inbound-processing] background processing failed', {
          emailId,
          err,
        });
      });
    });
  };
}
