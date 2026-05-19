CREATE TABLE "audit_checkpoint" (
	"id" bigserial PRIMARY KEY NOT NULL,
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
CREATE TABLE "challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"account_address" text NOT NULL,
	"nonce" text NOT NULL,
	"typed_data_json" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenges_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "execution_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"root_grant_hash" text NOT NULL,
	"session_id" text NOT NULL,
	"session_principal" text NOT NULL,
	"a2a_task_id" text DEFAULT '' NOT NULL,
	"mcp_server" text NOT NULL,
	"mcp_tool" text NOT NULL,
	"mcp_call_id" text NOT NULL,
	"event_type" text,
	"event_kind" text,
	"request_received_row_id" integer,
	"execution_path" text NOT NULL,
	"tool_grant_hash" text,
	"tool_executor" text,
	"target" text,
	"selector" text,
	"call_data_hash" text,
	"value_wei" text DEFAULT '0' NOT NULL,
	"tx_hash" text,
	"user_op_hash" text,
	"status" text NOT NULL,
	"error_reason" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"correlation_id" text,
	"prev_entry_hash" text,
	"entry_hash" text,
	CONSTRAINT "execution_audit_mcp_call_id_unique" UNIQUE("mcp_call_id")
);
--> statement-breakpoint
CREATE TABLE "handles" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"account_address" text NOT NULL,
	"agent_type" text NOT NULL,
	"endpoint_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handles_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "inter_service_nonces" (
	"scope" text NOT NULL,
	"nonce" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inter_service_nonces_scope_nonce_pk" PRIMARY KEY("scope","nonce")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_address" text NOT NULL,
	"session_key_address" text,
	"encrypted_package" text,
	"iv" text,
	"hmac_secret" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_agent_account" text,
	"encrypted_data_key" text,
	"key_version" text DEFAULT 'local-v1' NOT NULL,
	"kms_key_id" text,
	"variant" text,
	"risk_tier" text,
	"session_delegation_hash" text,
	"onchain_accepted_tx_hash" text
);
--> statement-breakpoint
CREATE INDEX "idx_audit_checkpoint_timestamp" ON "audit_checkpoint" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_session" ON "execution_audit" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_task" ON "execution_audit" USING btree ("a2a_task_id");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_tool" ON "execution_audit" USING btree ("mcp_tool");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_status" ON "execution_audit" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_received_at" ON "execution_audit" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_correlation" ON "execution_audit" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_event_type" ON "execution_audit" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_event_kind" ON "execution_audit" USING btree ("event_kind");--> statement-breakpoint
CREATE INDEX "idx_execution_audit_request_received_row_id" ON "execution_audit" USING btree ("request_received_row_id");--> statement-breakpoint
CREATE INDEX "idx_inter_service_nonces_used_at" ON "inter_service_nonces" USING btree ("used_at");