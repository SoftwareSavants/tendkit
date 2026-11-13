CREATE TABLE `support_autopilot_topics` (
	`topic` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'hold' NOT NULL,
	`status` text DEFAULT 'off' NOT NULL,
	`enabled_by` text,
	`enabled_at` integer,
	`paused_at` integer,
	`pause_reason` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `support_ai_settings` ADD `autopilot_stopped_at` integer;--> statement-breakpoint
ALTER TABLE `support_ai_settings` ADD `autopilot_stopped_by` text;--> statement-breakpoint
ALTER TABLE `support_ai_settings` ADD `autopilot_min_drafts` integer;--> statement-breakpoint
ALTER TABLE `support_ai_settings` ADD `autopilot_min_rate` real;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `topic` text;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `language` text;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `change` real;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `autopilot` text;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `send_at` integer;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `autopilot_block` text;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `follow_up` text;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `flagged_at` integer;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `flagged_by` text;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `flag_note` text;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `flag_reviewed_at` integer;--> statement-breakpoint
CREATE INDEX `support_suggestions_topic_idx` ON `support_suggestions` (`topic`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_suggestions_autopilot_idx` ON `support_suggestions` (`autopilot`,`send_at`);--> statement-breakpoint
CREATE INDEX `support_suggestions_sent_message_idx` ON `support_suggestions` (`sent_message_id`);--> statement-breakpoint
ALTER TABLE `support_ticket_insights` ADD `asks_for_human` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `support_ticket_insights` ADD `not_helped` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- The history recorded so far counts towards each topic's track record: its topic and language come from the ticket, and how much an edit changed from the correction kept for it.
UPDATE `support_suggestions` SET `topic` = (SELECT `topic` FROM `support_ticket_insights` WHERE `support_ticket_insights`.`ticket_id` = `support_suggestions`.`ticket_id`), `language` = (SELECT `language` FROM `support_ticket_insights` WHERE `support_ticket_insights`.`ticket_id` = `support_suggestions`.`ticket_id`);--> statement-breakpoint
UPDATE `support_suggestions` SET `change` = (SELECT `change` FROM `support_examples` WHERE `support_examples`.`suggestion_id` = `support_suggestions`.`id`) WHERE `status` = 'edited';
