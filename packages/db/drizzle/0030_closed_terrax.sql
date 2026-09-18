ALTER TABLE "mcp_server" ADD COLUMN "tools_catalog" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "catalog_at" timestamp;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "last_error_at" timestamp;