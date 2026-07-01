CREATE TABLE `daily_briefings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`briefing_date` text NOT NULL,
	`ai_summary` text DEFAULT '' NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`email_sent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_briefings_user_date_unique` ON `daily_briefings` (`user_id`,`briefing_date`);
