CREATE INDEX "support_events_type_idx" ON "support_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_created_idx" ON "support_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_solved_idx" ON "support_tickets" USING btree ("solved_at");