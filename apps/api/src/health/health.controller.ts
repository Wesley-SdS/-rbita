import { Controller, Get } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db } from "@orbita/db";

/**
 * Health do processo persistente. O /api/health "oficial" (banco, voz, ollama)
 * continua no Next até a migração da rota; este responde em /api/health/api e
 * é o que o watchdog da infra 24/7 vai vigiar.
 */
@Controller("api/health")
export class HealthController {
  @Get("api")
  async get() {
    const started = Date.now();
    let dbStatus = "up";
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbStatus = "down";
    }
    return { status: dbStatus === "up" ? "ok" : "error", process: "api", db: dbStatus, ms: Date.now() - started, ts: new Date().toISOString() };
  }
}
