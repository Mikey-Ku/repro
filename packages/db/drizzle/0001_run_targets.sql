ALTER TABLE "projects" ADD COLUMN "run_targets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reproduction_runs" ADD COLUMN "target_url" text;--> statement-breakpoint
ALTER TABLE "reproduction_runs" ADD COLUMN "target_name" text;