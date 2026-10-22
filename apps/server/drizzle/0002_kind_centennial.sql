ALTER TABLE "course_members" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT cm.course_id, cm.user_id, row_number() OVER (PARTITION BY cm.user_id ORDER BY c.name, cm.course_id) - 1 AS sort_order
  FROM course_members cm
  INNER JOIN courses c ON c.id = cm.course_id
)
UPDATE course_members cm SET sort_order = ranked.sort_order
FROM ranked
WHERE cm.course_id = ranked.course_id AND cm.user_id = ranked.user_id;--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY course_id ORDER BY updated_at DESC, id) - 1 AS sort_order
  FROM pages
)
UPDATE pages p SET sort_order = ranked.sort_order
FROM ranked
WHERE p.id = ranked.id;