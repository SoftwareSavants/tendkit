CREATE TABLE `support_ai_settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`guidance` text DEFAULT '' NOT NULL,
	`topics` text DEFAULT '[]' NOT NULL,
	`draft_on_arrival` integer DEFAULT true NOT NULL,
	`knowledge_synced_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `support_knowledge` (
	`source_id` text NOT NULL,
	`article_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`text` text NOT NULL,
	`content_hash` text NOT NULL,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `article_id`)
);
--> statement-breakpoint
CREATE TABLE `support_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`based_on_message_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`reason` text,
	`sources` text DEFAULT '[]' NOT NULL,
	`model_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_message_id` text,
	`final_text` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_suggestions_ticket_idx` ON `support_suggestions` (`ticket_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_ticket_insights` (
	`ticket_id` text PRIMARY KEY NOT NULL,
	`based_on_message_id` text,
	`topic` text,
	`urgency` text,
	`urgency_rank` integer,
	`urgency_reason` text,
	`mood` text,
	`language` text,
	`summary` text,
	`topic_set_by` text,
	`urgency_set_by` text,
	`pending_message_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_ticket_insights_pending_idx` ON `support_ticket_insights` (`pending_message_id`,`updated_at`);