CREATE TABLE "daily_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"course_id" uuid NOT NULL,
	"page_id" uuid,
	"page_title" text NOT NULL,
	"node_id" text,
	"topic" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"beyond_notes" text,
	"expansions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"usage" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_questions" ADD CONSTRAINT "daily_questions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_questions" ADD CONSTRAINT "daily_questions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_questions" ADD CONSTRAINT "daily_questions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_questions_user_day_idx" ON "daily_questions" USING btree ("user_id","day");