-- A user's manual link from an inbound email to one of their applications.
-- Per user, because several users can own the same inbound email row.
CREATE TABLE `email_application_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`inbound_email_id` text NOT NULL,
	`application_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbound_email_id`) REFERENCES `inbound_emails`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_application_links_user_email_unique` ON `email_application_links` (`user_id`,`inbound_email_id`);
