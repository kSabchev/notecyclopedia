CREATE TABLE "claude_api_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"request" jsonb NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"estimated_cost_usd" numeric(14, 8),
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_api_calls" ADD CONSTRAINT "claude_api_calls_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claude_api_calls_created_idx" ON "claude_api_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "claude_api_calls_user_idx" ON "claude_api_calls" USING btree ("user_id");