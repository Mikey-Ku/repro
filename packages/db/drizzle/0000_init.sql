CREATE TYPE "public"."finding_kind" AS ENUM('evidence', 'investigation');--> statement-breakpoint
CREATE TYPE "public"."incident_kind" AS ENUM('exception', 'unhandledrejection', 'network', 'console');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'passed', 'failed', 'error', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('recording', 'completed', 'expired');--> statement-breakpoint
CREATE TABLE "diagnostic_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"incident_id" uuid,
	"kind" "finding_kind" NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"evidence" jsonb,
	"investigation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_chunks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_chunks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" uuid NOT NULL,
	"batch_seq" integer NOT NULL,
	"first_seq" integer NOT NULL,
	"last_seq" integer NOT NULL,
	"event_count" integer NOT NULL,
	"encoding" text DEFAULT 'gzip' NOT NULL,
	"location" text DEFAULT 'inline' NOT NULL,
	"byte_size" integer NOT NULL,
	"payload" "bytea",
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"incident_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"language" text DEFAULT 'typescript' NOT NULL,
	"framework" text DEFAULT 'playwright' NOT NULL,
	"source_hash" text NOT NULL,
	"generator_version" text NOT NULL,
	"selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"omitted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expectations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" "incident_kind" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"fingerprint" text NOT NULL,
	"first_seq" integer NOT NULL,
	"first_ts" timestamp with time zone NOT NULL,
	"offset_ms" integer NOT NULL,
	"route" text,
	"release" text,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" integer NOT NULL,
	"refilled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reproduction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"generated_test_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"target" text DEFAULT 'demo' NOT NULL,
	"target_mode" text DEFAULT 'broken' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"failure_message" text,
	"logs" text,
	"exit_code" integer,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "session_status" DEFAULT 'recording' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"release" text,
	"environment" text,
	"browser_name" text,
	"browser_version" text,
	"os" text,
	"user_agent" text,
	"viewport_width" integer,
	"viewport_height" integer,
	"initial_url" text NOT NULL,
	"initial_route" text NOT NULL,
	"routes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"network_failure_count" integer DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"last_seq" integer DEFAULT -1 NOT NULL,
	"sdk_version" text,
	"external_user_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "diagnostic_findings" ADD CONSTRAINT "diagnostic_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_findings" ADD CONSTRAINT "diagnostic_findings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_findings" ADD CONSTRAINT "diagnostic_findings_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_chunks" ADD CONSTRAINT "event_chunks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_tests" ADD CONSTRAINT "generated_tests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_tests" ADD CONSTRAINT "generated_tests_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_tests" ADD CONSTRAINT "generated_tests_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_keys" ADD CONSTRAINT "ingestion_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reproduction_runs" ADD CONSTRAINT "reproduction_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reproduction_runs" ADD CONSTRAINT "reproduction_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reproduction_runs" ADD CONSTRAINT "reproduction_runs_generated_test_id_generated_tests_id_fk" FOREIGN KEY ("generated_test_id") REFERENCES "public"."generated_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_session_idx" ON "diagnostic_findings" USING btree ("session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "event_chunks_session_batch_idx" ON "event_chunks" USING btree ("session_id","batch_seq");--> statement-breakpoint
CREATE INDEX "generated_tests_session_idx" ON "generated_tests" USING btree ("session_id","version" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "generated_tests_project_idx" ON "generated_tests" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_project_created_idx" ON "incidents" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_project_fingerprint_idx" ON "incidents" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_session_fingerprint_idx" ON "incidents" USING btree ("session_id","fingerprint");--> statement-breakpoint
CREATE INDEX "ingestion_keys_prefix_idx" ON "ingestion_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "ingestion_keys_project_idx" ON "ingestion_keys" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jobs_status_run_after_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_pk" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "runs_test_idx" ON "reproduction_runs" USING btree ("generated_test_id","queued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_project_idx" ON "reproduction_runs" USING btree ("project_id","queued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_project_started_idx" ON "sessions" USING btree ("project_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_project_status_idx" ON "sessions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "sessions_project_release_idx" ON "sessions" USING btree ("project_id","release");--> statement-breakpoint
CREATE INDEX "sessions_project_route_idx" ON "sessions" USING btree ("project_id","initial_route");--> statement-breakpoint
CREATE INDEX "sessions_project_browser_idx" ON "sessions" USING btree ("project_id","browser_name");--> statement-breakpoint
CREATE INDEX "sessions_project_errors_idx" ON "sessions" USING btree ("project_id","error_count");