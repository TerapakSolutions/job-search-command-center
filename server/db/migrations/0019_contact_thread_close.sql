-- "Ping recruiter": a decline you sent suggests closing that recruiter's thread,
-- and a confirmed close stops its nudges. Additive only: two nullable columns,
-- no default, no backfill. Existing rows keep NULL (open, nothing suggested).
ALTER TABLE `contacts` ADD COLUMN `decline_detected_at` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD COLUMN `thread_closed_at` text;
