CREATE TABLE `support_ask_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`user_id` text NOT NULL,
	`turns` text DEFAULT '[]' NOT NULL,
	`questions` integer DEFAULT 0 NOT NULL,
	`answered` integer DEFAULT 0 NOT NULL,
	`helpful` integer,
	`ticket_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `support_ask_sessions_customer_idx` ON `support_ask_sessions` (`customer_id`,`last_at`);--> statement-breakpoint
CREATE INDEX `support_ask_sessions_created_idx` ON `support_ask_sessions` (`created_at`);--> statement-breakpoint
CREATE TABLE `support_outreach` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text,
	`spike_id` text,
	`customer_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`facts` text DEFAULT '[]' NOT NULL,
	`contact_id` text,
	`channel_id` text,
	`subject` text,
	`text` text,
	`draft` text,
	`sources` text DEFAULT '[]' NOT NULL,
	`language` text,
	`confident` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'drafting' NOT NULL,
	`send_at` integer,
	`auto_block` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`ticket_id` text,
	`message_id` text,
	`decided_by` text,
	`auto` integer DEFAULT false NOT NULL,
	`change` real,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `support_outreach_status_idx` ON `support_outreach` (`status`,`send_at`);--> statement-breakpoint
CREATE INDEX `support_outreach_customer_idx` ON `support_outreach` (`customer_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_outreach_kind_idx` ON `support_outreach` (`kind`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_outreach_spike_idx` ON `support_outreach` (`spike_id`,`customer_id`) WHERE "support_outreach"."spike_id" is not null;--> statement-breakpoint
CREATE TABLE `support_outreach_kinds` (
	`kind` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'off' NOT NULL,
	`enabled_by` text,
	`enabled_at` integer,
	`paused_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `support_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`facts` text DEFAULT '[]' NOT NULL,
	`dedupe_key` text,
	`status` text,
	`reason` text,
	`outreach_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_signals_dedupe_idx` ON `support_signals` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `support_signals_status_idx` ON `support_signals` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_signals_kind_idx` ON `support_signals` (`kind`,`created_at`);--> statement-breakpoint
ALTER TABLE `support_ai_settings` ADD `self_serve` integer DEFAULT false NOT NULL;