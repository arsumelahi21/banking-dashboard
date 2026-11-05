CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "scheduled_payments_transaction_idx" ON "scheduled_payments" USING btree ("org_id","transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_org_card_idx" ON "transactions" USING btree ("org_id","card_id");