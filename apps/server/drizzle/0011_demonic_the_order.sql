CREATE TABLE "page_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_page_id" uuid NOT NULL,
	"target_page_id" uuid NOT NULL,
	"target_node_id" text
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"level" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_references" ADD CONSTRAINT "page_references_source_page_id_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_references" ADD CONSTRAINT "page_references_target_page_id_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_references_source_idx" ON "page_references" USING btree ("source_page_id");--> statement-breakpoint
CREATE INDEX "page_references_target_idx" ON "page_references" USING btree ("target_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_page_node_idx" ON "terms" USING btree ("page_id","node_id");--> statement-breakpoint
CREATE INDEX "terms_fts_idx" ON "terms" USING gin (to_tsvector('simple', "text"));