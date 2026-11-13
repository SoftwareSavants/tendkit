CREATE TABLE `support_spikes` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`started_at` integer NOT NULL,
	`detected_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ended_at` integer,
	`tickets` integer NOT NULL,
	`customers` integer NOT NULL,
	`usual` real DEFAULT 0 NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text
);
--> statement-breakpoint
CREATE INDEX `support_spikes_detected_idx` ON `support_spikes` (`detected_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_spikes_ongoing_idx` ON `support_spikes` (`topic`) WHERE "support_spikes"."ended_at" is null;--> statement-breakpoint
CREATE INDEX `support_suggestions_decided_idx` ON `support_suggestions` (`decided_at`);