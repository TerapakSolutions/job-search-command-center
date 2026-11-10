-- Contract work: how pay is quoted, the engagement type, the staffing agency
-- (the company column stays the client) and when the candidate was
-- submitted. All optional; existing rows keep NULL, which reads as before.
ALTER TABLE `applications` ADD COLUMN `pay_period` text;
--> statement-breakpoint
ALTER TABLE `applications` ADD COLUMN `employment_type` text;
--> statement-breakpoint
ALTER TABLE `applications` ADD COLUMN `agency` text;
--> statement-breakpoint
ALTER TABLE `applications` ADD COLUMN `submitted_date` text;
