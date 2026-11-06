CREATE TABLE "formula_pins" (
	"user_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "formula_pins_user_id_page_id_node_id_pk" PRIMARY KEY("user_id","page_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "formula_pins" ADD CONSTRAINT "formula_pins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_pins" ADD CONSTRAINT "formula_pins_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Pins used to be part of the page, shared by everyone in its course: keep each pinned formula pinned for every
-- member of that course, so nobody's home page changes.
INSERT INTO "formula_pins" ("user_id", "page_id", "node_id")
SELECT DISTINCT cm."user_id", f."page_id", f."node_id"
  FROM "formulas" f
  JOIN "pages" p ON p."id" = f."page_id"
  JOIN "course_members" cm ON cm."course_id" = p."course_id"
 WHERE f."pinned" AND f."node_id" IS NOT NULL
ON CONFLICT DO NOTHING;
