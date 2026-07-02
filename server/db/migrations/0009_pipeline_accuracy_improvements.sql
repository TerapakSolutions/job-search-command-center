ALTER TABLE `inbound_emails` ADD COLUMN `is_forwarded` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `original_sender_email` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `original_sender_name` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `original_subject` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `original_recipient` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `original_sent_at` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `original_company` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `processing_timeline_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `contacts` ADD COLUMN `company` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `contacts` ADD COLUMN `source` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
CREATE TABLE `contacts_new` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `application_id` text,
  `name` text NOT NULL,
  `email` text DEFAULT '' NOT NULL,
  `linked_in` text DEFAULT '' NOT NULL,
  `company` text DEFAULT '' NOT NULL,
  `source` text DEFAULT 'manual' NOT NULL,
  `last_contact_date` text,
  `message_notes` text DEFAULT '' NOT NULL,
  `next_action` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
  FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `contacts_new` (
  `id`, `user_id`, `application_id`, `name`, `email`, `linked_in`,
  `company`, `source`, `last_contact_date`, `message_notes`, `next_action`,
  `created_at`, `updated_at`
)
SELECT
  `id`, `user_id`, `application_id`, `name`, `email`, `linked_in`,
  '', 'manual', `last_contact_date`, `message_notes`, `next_action`,
  `created_at`, `updated_at`
FROM `contacts`;
--> statement-breakpoint
DROP TABLE `contacts`;
--> statement-breakpoint
ALTER TABLE `contacts_new` RENAME TO `contacts`;
