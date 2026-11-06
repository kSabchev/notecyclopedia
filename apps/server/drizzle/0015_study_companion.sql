CREATE TABLE "exam_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"exam_date" text NOT NULL,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_visits" (
	"user_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"visited_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_visits_user_id_page_id_pk" PRIMARY KEY("user_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "quick_check" jsonb;--> statement-breakpoint
ALTER TABLE "exam_plans" ADD CONSTRAINT "exam_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_plans" ADD CONSTRAINT "exam_plans_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_plans_user_idx" ON "exam_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "page_visits_user_visited_idx" ON "page_visits" USING btree ("user_id","visited_at");