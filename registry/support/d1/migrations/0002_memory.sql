CREATE TABLE `support_approved_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`language` text,
	`ticket_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `support_example_terms` (
	`term` text NOT NULL,
	`example_id` text NOT NULL,
	PRIMARY KEY(`term`, `example_id`),
	FOREIGN KEY (`example_id`) REFERENCES `support_examples`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_example_terms_example_idx` ON `support_example_terms` (`example_id`);--> statement-breakpoint
CREATE TABLE `support_examples` (
	`id` text PRIMARY KEY NOT NULL,
	`suggestion_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`topic` text,
	`language` text,
	`question` text NOT NULL,
	`draft` text NOT NULL,
	`final` text NOT NULL,
	`change` real NOT NULL,
	`lesson` text,
	`lesson_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_examples_suggestion_idx` ON `support_examples` (`suggestion_id`);--> statement-breakpoint
CREATE INDEX `support_examples_ticket_idx` ON `support_examples` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `support_examples_topic_idx` ON `support_examples` (`topic`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_gap_tickets` (
	`gap_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`gap_id`, `ticket_id`),
	FOREIGN KEY (`gap_id`) REFERENCES `support_gaps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `support_gaps` (
	`id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_at` integer,
	`decided_by` text
);
--> statement-breakpoint
CREATE INDEX `support_gaps_status_idx` ON `support_gaps` (`status`);--> statement-breakpoint
CREATE TABLE `support_guidance_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule` text NOT NULL,
	`reason` text NOT NULL,
	`ticket_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_at` integer,
	`decided_by` text
);
--> statement-breakpoint
CREATE INDEX `support_guidance_suggestions_status_idx` ON `support_guidance_suggestions` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `support_ai_settings` ADD `memory_run_at` integer;--> statement-breakpoint
ALTER TABLE `support_ai_settings` ADD `memory_cursor` integer;