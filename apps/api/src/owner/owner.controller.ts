import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Put, UseGuards } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@orbita/db";
import { user } from "@orbita/db/auth-schema";
import { OwnerTransferError, getOwnerId, transferOwnership } from "@orbita/core/owner";
import { CurrentUser, SessionGuard, type SessionUser } from "../auth/session.guard";

const PutBody = z.object({ email: z.string().trim().email().max(254) });

/** Quem é o dono desta instância, e a transferência da posse (RV.1). */
@Controller("api/owner")
@UseGuards(SessionGuard)
export class OwnerController {
  @Get()
  async get(@CurrentUser() me: SessionUser) {
    const ownerId = await getOwnerId();
    const [dono] = ownerId ? await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, ownerId)).limit(1) : [];
    const souDono = ownerId === me.id;
    // quem não é dono vê o nome, não o e-mail (dado pessoal)
    return { isOwner: souDono, orphaned: !ownerId, owner: dono ? { name: dono.name, email: souDono ? dono.email : undefined } : null };
  }

  @Put()
  async transfer(@Body() body: unknown, @CurrentUser() me: SessionUser) {
    const parsed = PutBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("E-mail inválido");
    try {
      await transferOwnership(me.id, parsed.data.email);
      return { ok: true };
    } catch (e) {
      if (!(e instanceof OwnerTransferError)) throw e;
      if (e.status === 403) throw new ForbiddenException(e.message);
      if (e.status === 404) throw new NotFoundException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
