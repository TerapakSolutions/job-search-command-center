-- goals_set_at now means when goals were first set. Rows backfilled or saved
-- since 0011 hold the last save; created_at precedes every save, so use it.
UPDATE `job_search_goals` SET `goals_set_at` = `created_at` WHERE `goals_set_at` IS NOT NULL;
