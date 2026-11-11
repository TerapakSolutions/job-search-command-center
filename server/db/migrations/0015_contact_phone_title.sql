-- A recruiter's phone number and job title, read from their email signature
-- or typed by hand. Optional; existing rows keep NULL, which reads as before.
ALTER TABLE `contacts` ADD COLUMN `phone` text;
--> statement-breakpoint
ALTER TABLE `contacts` ADD COLUMN `title` text;
