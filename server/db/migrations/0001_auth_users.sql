CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`avatar_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_id_unique` ON `users` (`google_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
ALTER TABLE `applications` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `contacts` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `communications` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `follow_up_tasks` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `interviews` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `documents` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
