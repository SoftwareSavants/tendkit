CREATE TABLE "support_autopilot_topics" (
	"topic" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'hold' NOT NULL,
	"status" text DEFAULT 'off' NOT NULL,
	"enabled_by" text,
	"enabled_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"pause_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ai_settings" ADD COLUMN "autopilot_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_ai_settings" ADD COLUMN "autopilot_stopped_by" text;--> statement-breakpoint
ALTER TABLE "support_ai_settings" ADD COLUMN "autopilot_min_drafts" integer;--> statement-breakpoint
ALTER TABLE "support_ai_settings" ADD COLUMN "autopilot_min_rate" real;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "change" real;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "autopilot" text;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "autopilot_block" text;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "follow_up" text;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "flagged_by" text;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "flag_note" text;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "flag_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_ticket_insights" ADD COLUMN "asks_for_human" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "support_ticket_insights" ADD COLUMN "not_helped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "support_suggestions_topic_idx" ON "support_suggestions" USING btree ("topic","created_at");--> statement-breakpoint
CREATE INDEX "support_suggestions_autopilot_idx" ON "support_suggestions" USING btree ("autopilot","send_at");--> statement-breakpoint
CREATE INDEX "support_suggestions_sent_message_idx" ON "support_suggestions" USING btree ("sent_message_id");--> statement-breakpoint
-- The history recorded so far counts towards each topic's track record: its topic and language come from the ticket, and how much an edit changed from the correction kept for it.
UPDATE "support_suggestions" SET "topic" = (SELECT "topic" FROM "support_ticket_insights" WHERE "support_ticket_insights"."ticket_id" = "support_suggestions"."ticket_id"), "language" = (SELECT "language" FROM "support_ticket_insights" WHERE "support_ticket_insights"."ticket_id" = "support_suggestions"."ticket_id");--> statement-breakpoint
UPDATE "support_suggestions" SET "change" = (SELECT "change" FROM "support_examples" WHERE "support_examples"."suggestion_id" = "support_suggestions"."id") WHERE "status" = 'edited';
