CREATE TABLE "support_approved_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"language" text,
	"ticket_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_example_terms" (
	"term" text NOT NULL,
	"example_id" uuid NOT NULL,
	CONSTRAINT "support_example_terms_term_example_id_pk" PRIMARY KEY("term","example_id")
);
--> statement-breakpoint
CREATE TABLE "support_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"topic" text,
	"language" text,
	"question" text NOT NULL,
	"draft" text NOT NULL,
	"final" text NOT NULL,
	"change" real NOT NULL,
	"lesson" text,
	"lesson_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_gap_tickets" (
	"gap_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "support_gap_tickets_gap_id_ticket_id_pk" PRIMARY KEY("gap_id","ticket_id")
);
--> statement-breakpoint
CREATE TABLE "support_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"theme" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
CREATE TABLE "support_guidance_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule" text NOT NULL,
	"reason" text NOT NULL,
	"ticket_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
ALTER TABLE "support_ai_settings" ADD COLUMN "memory_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_ai_settings" ADD COLUMN "memory_cursor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_example_terms" ADD CONSTRAINT "support_example_terms_example_id_support_examples_id_fk" FOREIGN KEY ("example_id") REFERENCES "public"."support_examples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_examples" ADD CONSTRAINT "support_examples_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_gap_tickets" ADD CONSTRAINT "support_gap_tickets_gap_id_support_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."support_gaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_gap_tickets" ADD CONSTRAINT "support_gap_tickets_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_example_terms_example_idx" ON "support_example_terms" USING btree ("example_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_examples_suggestion_idx" ON "support_examples" USING btree ("suggestion_id");--> statement-breakpoint
CREATE INDEX "support_examples_ticket_idx" ON "support_examples" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_examples_topic_idx" ON "support_examples" USING btree ("topic","created_at");--> statement-breakpoint
CREATE INDEX "support_gaps_status_idx" ON "support_gaps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_guidance_suggestions_status_idx" ON "support_guidance_suggestions" USING btree ("status","created_at");