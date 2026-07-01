CREATE TABLE `inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`from_email` text DEFAULT '' NOT NULL,
	`to_email` text DEFAULT '' NOT NULL,
	`received_at` text NOT NULL,
	`payload` text NOT NULL,
	`processed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
