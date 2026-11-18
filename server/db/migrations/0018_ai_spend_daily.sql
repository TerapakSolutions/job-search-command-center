-- Daily AI spend cap: one row per Pacific calendar day, money in integer
-- micro-dollars. Additive only: a new table, nothing existing is read or changed.
CREATE TABLE `ai_spend_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
