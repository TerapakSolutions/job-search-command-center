-- "Ping recruiter": a decline you sent suggests closing that recruiter's thread,
-- a confirmed close stops its nudges, and "Keep open" is remembered. Additive
-- only: three nullable columns, no default, no backfill. Existing rows keep NULL (open, nothing suggested).
ALTER TABLE `contacts` ADD COLUMN `decline_detected_at` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD COLUMN `thread_closed_at` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD COLUMN `thread_kept_open_at` text;
