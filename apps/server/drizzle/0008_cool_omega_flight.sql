ALTER TABLE "ai_messages" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "usage" jsonb;