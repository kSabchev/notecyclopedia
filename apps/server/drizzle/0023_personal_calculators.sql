ALTER TABLE "calculators" DROP CONSTRAINT "calculators_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "calculators" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "calculators" ADD COLUMN "copied_from_id" uuid;--> statement-breakpoint
ALTER TABLE "calculators" ADD CONSTRAINT "calculators_copied_from_id_calculators_id_fk" FOREIGN KEY ("copied_from_id") REFERENCES "public"."calculators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculators" ADD CONSTRAINT "calculators_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;