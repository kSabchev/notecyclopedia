CREATE TABLE "course_constants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_constants" ADD CONSTRAINT "course_constants_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_constants" ADD CONSTRAINT "course_constants_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_constants_course_key_idx" ON "course_constants" USING btree ("course_id","key");--> statement-breakpoint
CREATE INDEX "course_constants_course_idx" ON "course_constants" USING btree ("course_id");