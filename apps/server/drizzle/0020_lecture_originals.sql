ALTER TABLE "files" ADD COLUMN "lecture_number" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "files_course_lecture_idx" ON "files" USING btree ("course_id","lecture_number");