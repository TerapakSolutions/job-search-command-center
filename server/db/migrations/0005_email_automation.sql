CREATE TABLE `email_automation_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`inbound_email_id` text NOT NULL,
	`action_type` text NOT NULL,
	`confidence` integer,
	`status` text DEFAULT 'completed' NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`resulting_changes_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbound_email_id`) REFERENCES `inbound_emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_automation_pending_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`inbound_email_id` text NOT NULL,
	`approval_type` text NOT NULL,
	`application_id` text,
	`proposed_status` text NOT NULL,
	`current_status` text,
	`confidence` integer NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbound_email_id`) REFERENCES `inbound_emails`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
