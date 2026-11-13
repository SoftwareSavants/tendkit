CREATE INDEX `support_events_type_idx` ON `support_events` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_created_idx` ON `support_tickets` (`created_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_solved_idx` ON `support_tickets` (`solved_at`);