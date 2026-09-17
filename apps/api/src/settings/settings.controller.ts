import { BadRequestException, Body, Controller, Delete, Get, Put, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { settings, SettingValidationError, isSettingKey, redactListing } from "@orbita/core/settings/index";
import { isOwner } from "@orbita/core/owner";
import { events } from "@orbita/core/events/index";
import { CurrentUser, SessionGuard, type SessionUser } from "../auth/session.guard";
import { OwnerGuard } from "../auth/owner.guard";

const PutBody = z.object({ key: z.string().min(1).max(120), value: z.unknown() });

/**
 * Tela de ajustes: lista tudo (com default e valor efetivo), grava um valor
 * validado pela definição, ou restaura o default. Ler: qualquer conta da casa
 * (chave sensível sem o valor). Mudar: só o dono (RV.1). Escopo global por ora; o
 * escopo por pessoa/dispositivo entra quando as ondas 3 e 6 precisarem.
 */
@Controller("api/settings")
@UseGuards(SessionGuard)
export class SettingsController {
  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const owner = await isOwner(user.id);
    return { ...redactListing(await settings.list(), owner), isOwner: owner };
  }

  @Put()
  @UseGuards(OwnerGuard)
  async put(@Body() body: unknown, @CurrentUser() user: SessionUser) {
    const parsed = PutBody.safeParse(body);
    if (!parsed.success || !isSettingKey(parsed.data.key)) throw new BadRequestException("Configuração desconhecida");
    try {
      const value = await settings.set(parsed.data.key, parsed.data.value);
      await events.emit("setting.changed", { key: parsed.data.key, value }, { userId: user.id });
      return { key: parsed.data.key, value };
    } catch (e) {
      if (e instanceof SettingValidationError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Delete()
  @UseGuards(OwnerGuard)
  async reset(@Query("key") key: string | undefined, @CurrentUser() user: SessionUser) {
    if (!key || !isSettingKey(key)) throw new BadRequestException("Configuração desconhecida");
    await settings.reset(key);
    await events.emit("setting.changed", { key, value: null, reset: true }, { userId: user.id });
    return { ok: true };
  }
}
