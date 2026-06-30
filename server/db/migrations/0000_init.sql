CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`role_title` text NOT NULL,
	`job_url` text DEFAULT '' NOT NULL,
	`work_location_type` text DEFAULT 'remote' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`salary_min` integer,
	`salary_max` integer,
	`date_applied` text,
	`status` text DEFAULT 'saved' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`interview_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`linked_in` text DEFAULT '' NOT NULL,
	`last_contact_date` text,
	`message_notes` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `communications` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`contact_id` text,
	`channel` text DEFAULT 'email' NOT NULL,
	`direction` text DEFAULT 'outbound' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `follow_up_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`contact_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due_date` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`type` text DEFAULT 'video' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text,
	`name` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE set null
);
