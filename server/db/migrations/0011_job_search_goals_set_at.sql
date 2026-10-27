ALTER TABLE `job_search_goals` ADD COLUMN `goals_set_at` text;
--> statement-breakpoint
UPDATE `job_search_goals` SET `goals_set_at` = `updated_at` WHERE `updated_at` <> `created_at`;
