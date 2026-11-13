CREATE TABLE "support_ask_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"user_id" text NOT NULL,
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions" integer DEFAULT 0 NOT NULL,
	"answered" integer DEFAULT 0 NOT NULL,
	"helpful" boolean,
	"ticket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid,
	"spike_id" uuid,
	"customer_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_id" uuid,
	"channel_id" text,
	"subject" text,
	"text" text,
	"draft" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" text,
	"confident" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'drafting' NOT NULL,
	"send_at" timestamp with time zone,
	"auto_block" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"ticket_id" uuid,
	"message_id" uuid,
	"decided_by" text,
	"auto" boolean DEFAULT false NOT NULL,
	"change" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "support_outreach_kinds" (
	"kind" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'off' NOT NULL,
	"enabled_by" text,
	"enabled_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" text,
	"reason" text,
	"outreach_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ai_settings" ADD COLUMN "self_serve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "support_ask_sessions_customer_idx" ON "support_ask_sessions" USING btree ("customer_id","last_at");--> statement-breakpoint
CREATE INDEX "support_ask_sessions_created_idx" ON "support_ask_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_outreach_status_idx" ON "support_outreach" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "support_outreach_customer_idx" ON "support_outreach" USING btree ("customer_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "support_outreach_kind_idx" ON "support_outreach" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_outreach_spike_idx" ON "support_outreach" USING btree ("spike_id","customer_id") WHERE "support_outreach"."spike_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "support_signals_dedupe_idx" ON "support_signals" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "support_signals_status_idx" ON "support_signals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_signals_kind_idx" ON "support_signals" USING btree ("kind","created_at");