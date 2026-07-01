ALTER TABLE `inbound_emails` ADD `classification` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `classification_confidence` integer;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `company_name` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `position_title` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `recruiter_name` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `requires_response` integer;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `suggested_action` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `action_due_at` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `interview_detected` integer;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `interview_datetime` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `ai_summary` text;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD `processed_at` text;
