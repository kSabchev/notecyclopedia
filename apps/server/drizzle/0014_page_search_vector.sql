-- Search reads a stored tsvector instead of building one from every page's text on each query.
-- The column is not in the Drizzle schema on purpose (see the comment on the pages table).
DROP INDEX "pages_fts_idx";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "title" || ' ' || "content_text")) STORED;--> statement-breakpoint
CREATE INDEX "pages_search_vector_idx" ON "pages" USING gin ("search_vector");
