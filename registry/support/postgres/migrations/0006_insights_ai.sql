CREATE TABLE "support_spikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"tickets" integer NOT NULL,
	"customers" integer NOT NULL,
	"usual" real DEFAULT 0 NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text
);
--> statement-breakpoint
CREATE INDEX "support_spikes_detected_idx" ON "support_spikes" USING btree ("detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_spikes_ongoing_idx" ON "support_spikes" USING btree ("topic") WHERE "support_spikes"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "support_suggestions_decided_idx" ON "support_suggestions" USING btree ("decided_at");