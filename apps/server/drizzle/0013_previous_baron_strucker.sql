DROP INDEX "daily_questions_user_day_idx";--> statement-breakpoint
CREATE INDEX "daily_questions_user_day_idx" ON "daily_questions" USING btree ("user_id","day");