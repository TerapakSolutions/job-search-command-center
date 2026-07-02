ALTER TABLE `email_automation_pending_approvals` ADD COLUMN `details_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `email_automation_pending_approvals` ADD COLUMN `suggested_action` text DEFAULT '' NOT NULL;
