CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"account_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_account_address_unique" UNIQUE("account_address")
);
--> statement-breakpoint
CREATE TABLE "action_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"action_type" text NOT NULL,
	"holder_wallet_id" text NOT NULL,
	"expires_at" integer NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"kind" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"duration_min" integer,
	"geo" text,
	"witnesses" text,
	"fulfills_entitlement_id" text,
	"fulfills_need_id" text,
	"fulfills_intent_id" text,
	"payload" text,
	"evidence_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_checkpoint" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"service" text DEFAULT 'person-mcp' NOT NULL,
	"latest_entry_id" integer NOT NULL,
	"latest_entry_hash" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"chain_id" integer NOT NULL,
	"signature" text NOT NULL,
	"signer_address" text NOT NULL,
	"sink_status" text DEFAULT 'not-configured' NOT NULL,
	"sink_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beliefs" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"statement" text NOT NULL,
	"tags" text,
	"informs_intent_id" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"principal" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"title" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"subject_agent" text NOT NULL,
	"content" text NOT NULL,
	"shared_with_subject" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_metadata" (
	"id" text PRIMARY KEY NOT NULL,
	"holder_wallet_id" text NOT NULL,
	"issuer_id" text NOT NULL,
	"schema_id" text NOT NULL,
	"cred_def_id" text NOT NULL,
	"credential_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"link_secret_id" text DEFAULT '' NOT NULL,
	"target_org_address" text
);
--> statement-breakpoint
CREATE TABLE "cross_delegation_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"grantee_agent" text NOT NULL,
	"scope" text NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"caveat_terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "engagement_holder_state" (
	"entitlement_id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"capacity_consumed" integer DEFAULT 0 NOT NULL,
	"holder_outcome_notes" text,
	"last_activity_id" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"provider" text NOT NULL,
	"identifier" text NOT NULL,
	"verified" integer DEFAULT 0 NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holder_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"person_principal" text NOT NULL,
	"wallet_context" text NOT NULL,
	"signer_eoa" text NOT NULL,
	"askar_profile" text NOT NULL,
	"link_secret_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"direction" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"kind" text NOT NULL,
	"addressed_to" text,
	"summary" text NOT NULL,
	"context" text,
	"status" text DEFAULT 'expressed' NOT NULL,
	"priority" text,
	"expires_at" timestamp with time zone,
	"on_chain_assertion_id" text,
	"live_acknowledgement_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "needs" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"intent_id" text NOT NULL,
	"kind" text NOT NULL,
	"requirements" text,
	"status" text DEFAULT 'open' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"geo" text,
	"capacity_needed" integer,
	"on_chain_assertion_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"kind" text NOT NULL,
	"payload" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offerings" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"intent_id" text NOT NULL,
	"kind" text NOT NULL,
	"capabilities" text,
	"capacity" integer,
	"visibility" text DEFAULT 'private' NOT NULL,
	"geo" text,
	"time_window" text,
	"on_chain_assertion_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oikos_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"person_name" text NOT NULL,
	"proximity" text,
	"spiritual_response_state" text,
	"last_contact_at" timestamp with time zone,
	"planned_conversation" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"intent_id" text NOT NULL,
	"metric" text NOT NULL,
	"target" text,
	"achieved" integer DEFAULT 0 NOT NULL,
	"achieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pinned_items" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"item_type" text NOT NULL,
	"item_ref" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prayers" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"schedule" text,
	"response_state" text,
	"linked_oikos_contact_id" text,
	"tags" text,
	"last_prayed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"display_name" text,
	"bio" text,
	"avatar_url" text,
	"email" text,
	"phone" text,
	"date_of_birth" text,
	"gender" text,
	"language" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state_province" text,
	"postal_code" text,
	"country" text,
	"location" text,
	"preferences" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_principal_unique" UNIQUE("principal")
);
--> statement-breakpoint
CREATE TABLE "proposal_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"round_id" text,
	"fund_mandate_id" text,
	"based_on_intent_id" text NOT NULL,
	"budget" text NOT NULL,
	"plan" text NOT NULL,
	"milestones" text NOT NULL,
	"desired_outcomes" text NOT NULL,
	"reporting_obligations" text NOT NULL,
	"organisational_background" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"last_edited_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"cloned_from_proposal_id" text,
	"basis" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "received_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"holder_principal" text NOT NULL,
	"delegator_principal" text NOT NULL,
	"audience" text NOT NULL,
	"kind" text NOT NULL,
	"subject_label" text,
	"delegation_json" text NOT NULL,
	"delegation_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ssi_proof_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"wallet_context" text NOT NULL,
	"holder_wallet_ref" text NOT NULL,
	"verifier_id" text NOT NULL,
	"purpose" text NOT NULL,
	"revealed_attrs" text NOT NULL,
	"predicates" text NOT NULL,
	"action_nonce" text NOT NULL,
	"pairwise_handle" text,
	"holder_binding_included" integer DEFAULT 0 NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_usage" (
	"jti" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"usage_limit" integer NOT NULL,
	"first_used_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"module_key" text NOT NULL,
	"program_key" text,
	"track" text,
	"status" text DEFAULT 'not-started' NOT NULL,
	"completed_at" timestamp with time zone,
	"hours_logged" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_overlap_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"holder_wallet_id" text NOT NULL,
	"principal" text NOT NULL,
	"counterparty_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"block_pin" text DEFAULT '0' NOT NULL,
	"public_set_commit" text NOT NULL,
	"evidence_commit" text NOT NULL,
	"score" real NOT NULL,
	"shared_count" integer NOT NULL,
	"output_kind" text DEFAULT 'score-only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"principal" text PRIMARY KEY NOT NULL,
	"language" text,
	"home_church" text,
	"location" text,
	"theme" text,
	"notifications" text,
	"extras" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"entitlement_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_activity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hw_principal_context" ON "holder_wallets" USING btree ("person_principal","wallet_context");--> statement-breakpoint
CREATE INDEX "idx_hw_principal" ON "holder_wallets" USING btree ("person_principal");--> statement-breakpoint
CREATE INDEX "idx_hw_signer_eoa" ON "holder_wallets" USING btree ("signer_eoa");--> statement-breakpoint
CREATE INDEX "idx_pinned_principal" ON "pinned_items" USING btree ("principal");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pinned_principal_ref" ON "pinned_items" USING btree ("principal","item_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recv_deleg_holder_hash" ON "received_delegations" USING btree ("holder_principal","delegation_hash");--> statement-breakpoint
CREATE INDEX "idx_recv_deleg_holder" ON "received_delegations" USING btree ("holder_principal");--> statement-breakpoint
CREATE INDEX "idx_recv_deleg_kind" ON "received_delegations" USING btree ("holder_principal","kind");--> statement-breakpoint
CREATE INDEX "idx_training_principal" ON "training_progress" USING btree ("principal");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_training_principal_module" ON "training_progress" USING btree ("principal","module_key");