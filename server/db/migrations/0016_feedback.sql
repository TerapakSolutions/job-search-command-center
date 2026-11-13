-- "Report a problem": one row per report, saved before any notifier runs.
-- Additive only: a new table, nothing existing is read or changed.
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_email` text NOT NULL,
	`message` text NOT NULL,
	`page_url` text,
	`user_agent` text,
	`app_version` text,
	`created_at` text NOT NULL,
	`slack_notified_at` text,
	`slack_error` text,
	`email_notified_at` text,
	`email_error` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_user_created_idx` ON `feedback` (`user_id`,`created_at`);
