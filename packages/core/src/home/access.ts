import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { haDomainRisk } from "@orbita/db/home-schema";
import type { ToolRisk } from "../tools/registry";
import { isToolRisk } from "../tools/registry";

/** Overrides de risco por domínio, cadastrados na tela (B3.8). */
export async function loadDomainRiskOverrides(userId: string): Promise<Map<string, ToolRisk>> {
  const rows = await db.select().from(haDomainRisk).where(eq(haDomainRisk.userId, userId));
  const map = new Map<string, ToolRisk>();
  for (const r of rows) if (isToolRisk(r.risk)) map.set(r.domain, r.risk);
  return map;
}

export async function setDomainRiskOverride(userId: string, domain: string, risk: ToolRisk | null): Promise<void> {
  if (risk === null) {
    await db.delete(haDomainRisk).where(and(eq(haDomainRisk.userId, userId), eq(haDomainRisk.domain, domain)));
    return;
  }
  await db
    .insert(haDomainRisk)
    .values({ userId, domain, risk, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [haDomainRisk.userId, haDomainRisk.domain], set: { risk, updatedAt: new Date() } });
}
