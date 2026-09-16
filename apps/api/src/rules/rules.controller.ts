import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, UseGuards } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { automationRule } from "@orbita/db/rule-schema";
import { RuleInputSchema, cronError } from "@orbita/core/rules/engine";
import { fireRuleNow } from "@orbita/core/rules/run";
import { CurrentUser, SessionGuard, type SessionUser } from "../auth/session.guard";

/** Regras proativas do usuário: CRUD + teste manual. Tudo filtrado por userId. */
@Controller("api/rules")
@UseGuards(SessionGuard)
export class RulesController {
  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const rules = await db.select().from(automationRule).where(eq(automationRule.userId, user.id)).orderBy(desc(automationRule.createdAt));
    return { rules };
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: SessionUser) {
    const data = this.validate(body);
    const [row] = await db
      .insert(automationRule)
      .values({ userId: user.id, ...data })
      .returning({ id: automationRule.id });
    return { id: row?.id };
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: SessionUser) {
    const data = this.validate(body);
    const [row] = await db
      .update(automationRule)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(automationRule.id, id), eq(automationRule.userId, user.id)))
      .returning({ id: automationRule.id });
    if (!row) throw new NotFoundException("Regra não encontrada");
    return { ok: true };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: SessionUser) {
    await db.delete(automationRule).where(and(eq(automationRule.id, id), eq(automationRule.userId, user.id)));
    return { ok: true };
  }

  /** Dispara a regra agora com um evento de teste (payload livre), para o dono ver o resultado. */
  @Post(":id/test")
  async test(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: SessionUser) {
    const [rule] = await db
      .select()
      .from(automationRule)
      .where(and(eq(automationRule.id, id), eq(automationRule.userId, user.id)))
      .limit(1);
    if (!rule) throw new NotFoundException("Regra não encontrada");
    const trigger = rule.trigger as { kind: string; type?: string };
    const payload = (body && typeof body === "object" ? (body as Record<string, unknown>).payload : undefined) ?? {};
    // ignora as condições de propósito: o teste é para ver as AÇÕES acontecerem
    const context = {
      type: trigger.kind === "event" && trigger.type ? trigger.type : "cron",
      payload: typeof payload === "object" && payload ? payload : {},
      source: "teste",
      at: new Date().toISOString(),
    };
    const fired = await fireRuleNow(rule, context);
    return { disparadas: fired ? 1 : 0 };
  }

  private validate(body: unknown) {
    const parsed = RuleInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Dados inválidos");
    if (parsed.data.trigger.kind === "cron") {
      const err = cronError(parsed.data.trigger.expr);
      if (err) throw new BadRequestException(err);
    }
    return parsed.data;
  }
}
