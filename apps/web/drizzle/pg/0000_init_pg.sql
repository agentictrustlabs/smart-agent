CREATE TABLE "commitment_thread_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_agent" text,
	"body" text NOT NULL,
	"attachment_uri" text,
	"hash_anchor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"policy_doc_uri" text,
	"policy_summary" text,
	"current_state" text DEFAULT 'draft' NOT NULL,
	"required_signers" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"scheduled_for" timestamp with time zone,
	"occurred_at" timestamp with time zone,
	"notes" text,
	"logged_by" text,
	"source_activity_id" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_tranches" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"idx" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"scheduled_for" timestamp with time zone,
	"released_at" timestamp with time zone,
	"report_required" integer DEFAULT 1 NOT NULL,
	"report_thread_entry_id" text,
	"state" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"source_match_id" text NOT NULL,
	"holder_intent_id" text NOT NULL,
	"provider_intent_id" text NOT NULL,
	"holder_agent" text NOT NULL,
	"provider_agent" text NOT NULL,
	"hub_id" text NOT NULL,
	"terms" text NOT NULL,
	"capacity_unit" text NOT NULL,
	"capacity_granted" integer NOT NULL,
	"capacity_remaining" integer NOT NULL,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"holder_outcome_id" text,
	"provider_outcome_id" text,
	"holder_confirmed_at" timestamp with time zone,
	"provider_confirmed_at" timestamp with time zone,
	"witness_agent" text,
	"witness_signed_at" timestamp with time zone,
	"review_ids" text,
	"assertion_id" text,
	"evidence_bundle_hash" text,
	"evidence_pinned_at" timestamp with time zone,
	"phase" text DEFAULT 'granted' NOT NULL,
	"engagement_kind" text DEFAULT 'delivery' NOT NULL,
	"parent_engagement_id" text,
	"status" text DEFAULT 'granted' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"entitlement_id" text NOT NULL,
	"assignee_agent" text NOT NULL,
	"task_kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"cadence" text DEFAULT 'one-shot' NOT NULL,
	"due_at" timestamp with time zone,
	"resolved_by_activity_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"object" text NOT NULL,
	"topic" text,
	"intent_type" text NOT NULL,
	"intent_type_label" text NOT NULL,
	"expressed_by_agent" text NOT NULL,
	"expressed_by_user_id" text,
	"addressed_to" text NOT NULL,
	"hub_id" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"payload" text,
	"status" text DEFAULT 'expressed' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"expected_outcome" text,
	"projection_ref" text,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"agent_address" text NOT NULL,
	"agent_name" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "local_user_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"wallet_address" text NOT NULL,
	"did" text,
	"private_key" text,
	"smart_account_address" text,
	"person_agent_address" text,
	"agent_name" text,
	"onboarded_at" timestamp with time zone,
	"account_salt_rotation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_user_accounts_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "local_user_accounts_did_unique" UNIQUE("did")
);
--> statement-breakpoint
CREATE TABLE "policy_signers" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"agent" text NOT NULL,
	"role" text NOT NULL,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_address" text NOT NULL,
	"delegation_json" text NOT NULL,
	"delegation_hash" text NOT NULL,
	"recovery_config_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_delegations_account_address_unique" UNIQUE("account_address")
);
--> statement-breakpoint
CREATE TABLE "recovery_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"account_address" text NOT NULL,
	"intent_hash" text NOT NULL,
	"new_credential_id" text NOT NULL,
	"new_pub_key_x" text NOT NULL,
	"new_pub_key_y" text NOT NULL,
	"ready_at" integer NOT NULL,
	"status" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_intents_intent_hash_unique" UNIQUE("intent_hash")
);
--> statement-breakpoint
CREATE TABLE "training_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"program" text DEFAULT 'bdc' NOT NULL,
	"hours" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commitment_thread_entries" ADD CONSTRAINT "commitment_thread_entries_engagement_id_entitlements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_policies" ADD CONSTRAINT "engagement_policies_engagement_id_entitlements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_sessions" ADD CONSTRAINT "engagement_sessions_engagement_id_entitlements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_tranches" ADD CONSTRAINT "engagement_tranches_engagement_id_entitlements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_work_items" ADD CONSTRAINT "fulfillment_work_items_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_signers" ADD CONSTRAINT "policy_signers_policy_id_engagement_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."engagement_policies"("id") ON DELETE no action ON UPDATE no action;