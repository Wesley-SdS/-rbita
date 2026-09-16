import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { TOOL_RISKS, getTool, riskAtLeast, setToolOverride, toolCatalog } from "@orbita/core/tools/index";
import { events } from "@orbita/core/events/index";
import { CurrentUser, SessionGuard, type SessionUser } from "../auth/session.guard";

const PutBody = z.object({
  enabled: z.boolean().optional(),
  // null = volta ao risco declarado no código
  risk: z.enum(TOOL_RISKS).nullable().optional(),
});

/** Catálogo de ferramentas com tela (TL.5): ver, ligar/desligar e ajustar o risco. */
@Controller("api/tools")
@UseGuards(SessionGuard)
export class ToolsController {
  @Get()
  async list(@CurrentUser() user: SessionUser) {
    return { tools: await toolCatalog(user.id) };
  }

  @Put(":name")
  async update(@Param("name") name: string, @Body() body: unknown, @CurrentUser() user: SessionUser) {
    const def = getTool(name);
    if (!def) throw new NotFoundException("Ferramenta desconhecida");
    const parsed = PutBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos");
    // o risco só sobe: rebaixar tiraria a aprovação humana de uma tool com efeito externo
    if (parsed.data.risk && !riskAtLeast(parsed.data.risk, def.risk)) {
      throw new BadRequestException(`Não é possível reduzir o risco de "${name}" abaixo do declarado (${def.risk})`);
    }
    await setToolOverride(name, { enabled: parsed.data.enabled, riskOverride: parsed.data.risk });
    await events.emit("tool.config_changed", { name, ...parsed.data }, { userId: user.id });
    return { ok: true };
  }
}
