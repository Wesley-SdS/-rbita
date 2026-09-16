CREATE TABLE "tool_config" (
	"name" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"risk_override" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "risk" text DEFAULT 'efeito_externo' NOT NULL;