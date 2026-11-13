ALTER TABLE `support_outreach` ADD `follow_up` text;--> statement-breakpoint
ALTER TABLE `support_outreach` ADD `flagged_at` integer;--> statement-breakpoint
ALTER TABLE `support_outreach` ADD `flagged_by` text;--> statement-breakpoint
ALTER TABLE `support_outreach` ADD `flag_note` text;--> statement-breakpoint
ALTER TABLE `support_outreach` ADD `flag_reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `support_outreach_kinds` ADD `pause_reason` text;