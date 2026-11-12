CREATE TABLE "support_ai_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"guidance" text DEFAULT '' NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft_on_arrival" boolean DEFAULT true NOT NULL,
	"knowledge_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_knowledge" (
	"source_id" text NOT NULL,
	"article_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"text" text NOT NULL,
	"content_hash" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "support_knowledge_source_id_article_id_pk" PRIMARY KEY("source_id","article_id")
);
--> statement-breakpoint
CREATE TABLE "support_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"based_on_message_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"reason" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_message_id" uuid,
	"final_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "support_ticket_insights" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"based_on_message_id" uuid,
	"topic" text,
	"urgency" text,
	"urgency_rank" integer,
	"urgency_reason" text,
	"mood" text,
	"language" text,
	"summary" text,
	"topic_set_by" text,
	"urgency_set_by" text,
	"pending_message_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_suggestions" ADD CONSTRAINT "support_suggestions_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_insights" ADD CONSTRAINT "support_ticket_insights_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_suggestions_ticket_idx" ON "support_suggestions" USING btree ("ticket_id","status","created_at");--> statement-breakpoint
CREATE INDEX "support_ticket_insights_pending_idx" ON "support_ticket_insights" USING btree ("pending_message_id","updated_at");