DROP INDEX "claude_api_calls_user_idx";--> statement-breakpoint
ALTER TABLE "formulas" ADD COLUMN "node_id" text;--> statement-breakpoint
CREATE INDEX "claude_api_calls_user_created_idx" ON "claude_api_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "formulas_page_node_idx" ON "formulas" USING btree ("page_id","node_id");