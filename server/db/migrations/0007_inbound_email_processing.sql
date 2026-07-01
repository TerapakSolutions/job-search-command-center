ALTER TABLE `inbound_emails` ADD `processing_status` text DEFAULT 'unprocessed' NOT NULL;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `processing_started_at` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `processing_completed_at` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `processing_error` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `last_processed_at` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `processing_attempts` integer DEFAULT 0 NOT NULL;
