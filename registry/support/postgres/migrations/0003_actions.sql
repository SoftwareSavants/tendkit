CREATE TABLE "support_action_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"suggestion_id" uuid,
	"action" text NOT NULL,
	"title" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" text,
	"data" jsonb,
	"error" text,
	"approved_by" text,
	"duration_ms" integer,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "support_ai_settings" ADD COLUMN "disabled_actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "support_action_runs" ADD CONSTRAINT "support_action_runs_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_action_runs_ticket_idx" ON "support_action_runs" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_action_runs_suggestion_idx" ON "support_action_runs" USING btree ("suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_action_runs_idempotency_idx" ON "support_action_runs" USING btree ("idempotency_key");