import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { and, desc, eq, or, isNull } from "drizzle-orm";
import { db } from "@orbita/db";
import { eventLog } from "@orbita/db/event-schema";
import { CurrentUser, SessionGuard, type SessionUser } from "../auth/session.guard";

/** Trilha de eventos visível na UI: os do usuário e os do sistema (sem dono). */
@Controller("api/events")
@UseGuards(SessionGuard)
export class EventsController {
  @Get()
  async list(@CurrentUser() user: SessionUser, @Query("limit") limitRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 200);
    const rows = await db
      .select()
      .from(eventLog)
      .where(and(or(eq(eventLog.userId, user.id), isNull(eventLog.userId))))
      .orderBy(desc(eventLog.id))
      .limit(limit);
    return { events: rows };
  }
}
