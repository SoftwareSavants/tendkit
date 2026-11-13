ALTER TABLE "support_outreach" ADD COLUMN "follow_up" text;--> statement-breakpoint
ALTER TABLE "support_outreach" ADD COLUMN "flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_outreach" ADD COLUMN "flagged_by" text;--> statement-breakpoint
ALTER TABLE "support_outreach" ADD COLUMN "flag_note" text;--> statement-breakpoint
ALTER TABLE "support_outreach" ADD COLUMN "flag_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_outreach_kinds" ADD COLUMN "pause_reason" text;