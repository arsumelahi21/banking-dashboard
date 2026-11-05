ALTER TABLE "recipients" ADD CONSTRAINT "recipients_org_id_unique" UNIQUE("org_id","id");
--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('ach', 'wire');
--> statement-breakpoint
CREATE TYPE "public"."scheduled_status" AS ENUM('scheduled', 'completed', 'failed', 'canceled');
--> statement-breakpoint
CREATE TABLE "payment_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"recipient_id" uuid,
	"method" "payment_method",
	"amount_cents" bigint NOT NULL,
	"memo" text,
	"scheduled_for" date NOT NULL,
	"status" "scheduled_status" DEFAULT 'scheduled' NOT NULL,
	"transaction_id" uuid,
	"failure_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_payments_idempotency_unique" UNIQUE("org_id","idempotency_key"),
	CONSTRAINT "scheduled_payments_amount_positive" CHECK ("scheduled_payments"."amount_cents" > 0),
	CONSTRAINT "scheduled_payments_one_destination" CHECK (("scheduled_payments"."to_account_id" is null) <> ("scheduled_payments"."recipient_id" is null))
);
--> statement-breakpoint
ALTER TABLE "payment_challenges" ADD CONSTRAINT "payment_challenges_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_challenges" ADD CONSTRAINT "payment_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_from_fk" FOREIGN KEY ("org_id","from_account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_to_fk" FOREIGN KEY ("org_id","to_account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_recipient_fk" FOREIGN KEY ("org_id","recipient_id") REFERENCES "public"."recipients"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_transaction_fk" FOREIGN KEY ("org_id","transaction_id") REFERENCES "public"."transactions"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "payment_challenges_user_idx" ON "payment_challenges" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "scheduled_payments_due_idx" ON "scheduled_payments" USING btree ("org_id","status","scheduled_for");
