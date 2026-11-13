CREATE TABLE `support_action_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`suggestion_id` text,
	`action` text NOT NULL,
	`title` text NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`summary` text,
	`data` text,
	`error` text,
	`approved_by` text,
	`duration_ms` integer,
	`idempotency_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_action_runs_ticket_idx` ON `support_action_runs` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_action_runs_suggestion_idx` ON `support_action_runs` (`suggestion_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_action_runs_idempotency_idx` ON `support_action_runs` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `support_ai_settings` ADD `disabled_actions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `support_suggestions` ADD `actions` text DEFAULT '[]' NOT NULL;