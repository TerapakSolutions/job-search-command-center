CREATE TABLE `job_search_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`daily_goal` integer DEFAULT 5 NOT NULL,
	`weekly_goal` integer DEFAULT 25 NOT NULL,
	`monthly_goal` integer DEFAULT 100 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_search_goals_user_unique` ON `job_search_goals` (`user_id`);--> statement-breakpoint
CREATE TABLE `application_outcome_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`first_recruiter_response_at` text,
	`first_interview_at` text,
	`offer_received_at` text,
	`days_to_first_response` integer,
	`days_application_to_interview` integer,
	`days_interview_to_offer` integer,
	`had_recruiter_response` integer DEFAULT false NOT NULL,
	`had_interview` integer DEFAULT false NOT NULL,
	`received_offer` integer DEFAULT false NOT NULL,
	`last_computed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_outcome_metrics_app_unique` ON `application_outcome_metrics` (`application_id`);
