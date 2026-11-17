-- "Follow up after a meeting": business days, per user, set in Settings.
-- Additive only: a nullable column, no default, no backfill. Existing rows keep
-- NULL, which reads as the default (3).
ALTER TABLE `users` ADD COLUMN `follow_up_after_days` integer;
