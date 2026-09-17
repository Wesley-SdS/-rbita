import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { room } from "@orbita/db/home-schema";
import { getHaConnection } from "../../home/connection";
import { callService, HomeAssistantError } from "../../home/client";
import { entitiesInRoom, findEntities, type EntityHit } from "../../home/entities";
import { DISPATCH_DOMAINS, domainOf, resolveDomainRisk } from "../../home/domain-risk";
import { loadDomainRiskOverrides } from "../../home/access";
import { authorizeEntityForRequester } from "../../home/room-permission";
import { registerTools, needsApproval, type ToolContext, type ToolDef } from "../registry";

/**
 * Tools COMPOSTAS da casa (B3.5): listar, consultar, acionar, cena — nunca
 * uma tool por entidade (centenas de luzes não cabem no contexto do modelo).
 *
 * O risco de ACIONAR depende do DOMÍNIO da entidade alvo (B3.8), que só se
 * sabe em tempo de execução — mas o gate humano (§5.1) é derivado do risco
 * DECLARADO da tool, antes de rodar. Por isso duas tools, não uma:
 * `casa_acionar` (declarada "escrita", roda direto) recusa e não executa se o
 * domínio real da entidade for perigoso; `casa_acionar_com_aprovacao`
 * (declarada "perigoso") sempre passa pelo gate.
 *
 * CORREÇÃO (auditoria pós-Onda 6): o gate calculava o risco sobre o domínio
 * de `entidade`, mas o Home Assistant executa o par (servico, dados) — e
 * `dados` podia carregar um `entity_id`/`entities`/`device_id`/`area_id`
 * que redireciona a chamada real para um alvo diferente do avaliado
 * (ex.: `entidade:"light.sala"` avaliado como "escrita", com
 * `dados:{entity_id:"lock.porta"}` de verdade destrancando a porta). E
 * serviços de DESPACHO (`scene.apply`, `script.turn_on`,
 * `homeassistant.turn_on`) agem sobre entidades arbitrárias por design,
 * então nenhum domínio "alvo" os descreve com segurança. `runAcionar` agora
 * recusa (a) qualquer `dados` com chave de redirecionamento de alvo e
 * (b) qualquer domínio de despacho (`DISPATCH_DOMAINS`), nas DUAS tools —
 * inclusive na com aprovação, porque o resumo da fila não mostra `dados` o
 * bastante para uma aprovação informada de um despacho arbitrário.
 */
const TARGET_OVERRIDE_KEYS = new Set(["entity_id", "entities", "device_id", "area_id", "target", "area_name", "label_id"]);

async function requireConnection(userId: string) {
  const conn = await getHaConnection(userId);
  if (!conn) throw new Error("Home Assistant não conectado. Cadastre em Casa > Home Assistant.");
  return conn;
}

function fmt(e: EntityHit) {
  return { entidade: e.entityId, nome: e.friendlyName, dominio: e.domain, estado: e.state, comodo: e.roomId };
}

export const casa_listar_comodos: ToolDef<import("zod").ZodObject<Record<string, never>>> = {
  name: "casa_listar_comodos",
  domain: "casa",
  description: "Lista os cômodos da casa cadastrados pelo dono.",
  risk: "leitura",
  requires: { homeAssistant: true },
  keywords: ["cômodo", "cômodos", "casa", "sala", "quarto", "cozinha"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const rows = await db.select().from(room).where(eq(room.userId, userId));
    return { comodos: rows.map((r) => ({ id: r.id, nome: r.name })) };
  },
};

const BuscarInput = z.object({ consulta: z.string().max(200).describe('ex.: "luz da sala", "fechadura da frente"') });
export const casa_buscar_dispositivos: ToolDef<typeof BuscarInput> = {
  name: "casa_buscar_dispositivos",
  domain: "casa",
  description: "Busca dispositivos da casa por descrição em linguagem natural (ex.: 'a luz da sala', 'o ar da sala de reuniões'). Use antes de acionar quando não souber o id exato da entidade.",
  risk: "leitura",
  requires: { homeAssistant: true },
  keywords: ["luz", "luzes", "dispositivo", "dispositivos", "tomada", "fechadura", "ar condicionado", "clima", "casa"],
  inputSchema: BuscarInput,
  run: async ({ consulta }, { userId }) => {
    const hits = await findEntities(userId, consulta);
    return { dispositivos: hits.map(fmt) };
  },
};

const RoomInput = z.object({
  comodoId: z.string().describe('id do cômodo (de casa_listar_comodos) ou "aqui" para o cômodo do dispositivo que está falando'),
});
export const casa_listar_dispositivos_do_comodo: ToolDef<typeof RoomInput> = {
  name: "casa_listar_dispositivos_do_comodo",
  domain: "casa",
  description: 'Lista todos os dispositivos de um cômodo (id vindo de casa_listar_comodos, ou "aqui" para o cômodo de onde o pedido veio). Use para "apaga tudo da sala" ou "o que tem aqui".',
  risk: "leitura",
  requires: { homeAssistant: true },
  keywords: ["comodo", "sala", "quarto", "tudo", "dispositivos", "aqui", "daqui"],
  inputSchema: RoomInput,
  run: async ({ comodoId }, ctx) => {
    let alvo = comodoId;
    if (AQUI.test(comodoId.trim())) {
      const aqui = await comodoDaOrigem(ctx);
      if (!aqui) return { erro: 'Não sei onde é "aqui": este dispositivo não está cadastrado num cômodo. Cadastre em Casa, ou diga o nome do cômodo.' };
      alvo = aqui.roomId;
    }
    if (!/^[0-9a-f-]{36}$/i.test(alvo)) return { erro: "Informe o id do cômodo (de casa_listar_comodos) ou \"aqui\"." };
    const hits = await entitiesInRoom(ctx.userId, alvo);
    return { dispositivos: hits.map(fmt) };
  },
};

// entity_id canônico: o HA aceita "LIGHT.SALA" ou "light.a,light.b"; a permissão
// por cômodo compara com o id sincronizado, então a entrada é normalizada e validada
const EntityId = z.string().trim().toLowerCase().regex(/^[a-z_]+\.[a-z0-9_]+$/, "entity_id inválido (formato dominio.objeto)");

const EstadoInput = z.object({ entidade: EntityId.describe("entity_id do Home Assistant, ex.: light.sala") });
export const casa_consultar_estado: ToolDef<typeof EstadoInput> = {
  name: "casa_consultar_estado",
  domain: "casa",
  description: "Consulta o estado ATUAL de um dispositivo específico pelo entity_id (obtido em casa_buscar_dispositivos).",
  risk: "leitura",
  requires: { homeAssistant: true },
  keywords: ["estado", "ligado", "desligado", "status", "temperatura"],
  inputSchema: EstadoInput,
  run: async ({ entidade }, { userId }) => {
    const { baseUrl, token } = await requireConnection(userId);
    const { getState } = await import("../../home/client");
    try {
      const s = await getState(baseUrl, token, entidade);
      return { entidade: s.entity_id, estado: s.state, atributos: s.attributes };
    } catch (e) {
      return { erro: e instanceof HomeAssistantError ? e.message : "Falha ao consultar o Home Assistant" };
    }
  },
};

/**
 * "Aqui" (B5.4, Onda 12): o cômodo do dispositivo que fez o pedido. Sem
 * dispositivo cadastrado, devolve null e a tool responde pedindo o cômodo, em
 * vez de adivinhar e acionar o lugar errado.
 */
async function comodoDaOrigem(ctx: ToolContext): Promise<{ roomId: string; roomName: string | null } | null> {
  const o = ctx.origin ? await ctx.origin().catch(() => null) : null;
  return o?.roomId ? { roomId: o.roomId, roomName: o.roomName } : null;
}

const AQUI = /^(aqui|daqui|deste c[oô]modo|neste c[oô]modo|este c[oô]modo)$/i;

/** Permissão por pessoa e cômodo de quem pede (Onda 9): o registro chama antes de executar ou enfileirar. */
const autorizarEntidade = async ({ entidade }: { entidade: string }, ctx: ToolContext) =>
  authorizeEntityForRequester(ctx.userId, entidade, ctx.requester ? await ctx.requester().catch(() => null) : null);

const AcionarInput = z.object({
  entidade: EntityId.describe("entity_id alvo, ex.: light.sala, climate.quarto"),
  servico: z.string().describe('ação do domínio, ex.: "turn_on", "turn_off", "set_temperature"'),
  dados: z.record(z.string(), z.unknown()).optional().describe('parâmetros extras do serviço, ex.: {"temperature": 22}'),
});

async function runAcionar(input: z.infer<typeof AcionarInput>, userId: string) {
  const domain = domainOf(input.entidade);
  if (DISPATCH_DOMAINS.has(domain)) {
    return { acionado: false, erro: `"${domain}" não é acionável por aqui (despacha para outras entidades). Para cena, use casa_ativar_cena.` };
  }
  const chaveInvalida = input.dados ? Object.keys(input.dados).find((k) => TARGET_OVERRIDE_KEYS.has(k)) : undefined;
  if (chaveInvalida) {
    return { acionado: false, erro: `"${chaveInvalida}" não é permitido em "dados" (redireciona o alvo real do comando).` };
  }
  const { baseUrl, token } = await requireConnection(userId);
  try {
    await callService(baseUrl, token, domain, input.servico, { entity_id: input.entidade, ...(input.dados ?? {}) });
    return { acionado: true, entidade: input.entidade, servico: input.servico };
  } catch (e) {
    return { acionado: false, erro: e instanceof HomeAssistantError ? e.message : "Falha ao acionar o Home Assistant" };
  }
}

export const casa_acionar: ToolDef<typeof AcionarInput> = {
  name: "casa_acionar",
  domain: "casa",
  description: "Aciona um dispositivo direto (luz, tomada, mídia, clima, ventilador, cena): liga, desliga, ajusta. NÃO funciona para fechadura, alarme, portão ou registro — essas exigem casa_acionar_com_aprovacao.",
  risk: "escrita",
  requires: { homeAssistant: true },
  keywords: ["liga", "ligar", "desliga", "desligar", "acende", "apaga", "ajusta", "acionar"],
  inputSchema: AcionarInput,
  summarize: ({ entidade, servico, dados }) => `Acionar ${entidade}: ${servico}${dados ? ` (${JSON.stringify(dados).slice(0, 80)})` : ""}`,
  authorize: autorizarEntidade,
  run: async (input, { userId }) => {
    const domain = domainOf(input.entidade);
    const overrides = await loadDomainRiskOverrides(userId);
    const risk = resolveDomainRisk(domain, overrides);
    if (needsApproval(risk)) {
      // defesa em profundidade: mesmo que o modelo chame a tool errada, o
      // domínio real da entidade decide — nunca aciona direto o que é gate.
      return { acionado: false, erro: `"${domain}" exige aprovação. Use a ferramenta casa_acionar_com_aprovacao para "${input.entidade}".` };
    }
    return runAcionar(input, userId);
  },
};

export const casa_acionar_com_aprovacao: ToolDef<typeof AcionarInput> = {
  name: "casa_acionar_com_aprovacao",
  domain: "casa",
  description: "Propõe acionar fechadura, alarme, portão, garagem ou registro (água/gás). SEMPRE pede aprovação do dono antes de executar, mesmo para destrancar ou abrir. Use para qualquer ação de segurança física.",
  risk: "perigoso",
  requires: { homeAssistant: true },
  keywords: ["destranca", "tranca", "fechadura", "alarme", "portão", "garagem", "abre", "fecha"],
  inputSchema: AcionarInput,
  summarize: ({ entidade, servico, dados }) => `Acionar (segurança) ${entidade}: ${servico}${dados ? ` (${JSON.stringify(dados).slice(0, 80)})` : ""}`,
  authorize: autorizarEntidade,
  run: async (input, { userId }) => runAcionar(input, userId),
};

const CenaInput = z.object({ entidade: EntityId.describe("entity_id da cena, ex.: scene.boa_noite") });
export const casa_ativar_cena: ToolDef<typeof CenaInput> = {
  name: "casa_ativar_cena",
  domain: "casa",
  description: "Ativa uma cena do Home Assistant (um conjunto de ajustes pré-configurado pelo dono, ex.: 'boa noite', 'modo cinema'). A cena em si só ajusta dispositivos diretos; se o dono configurou algo de segurança dentro dela no próprio HA, isso é responsabilidade do HA, não desta tool.",
  risk: "escrita",
  requires: { homeAssistant: true },
  keywords: ["cena", "modo", "boa noite", "cinema", "ambiente"],
  inputSchema: CenaInput,
  summarize: ({ entidade }) => `Ativar cena ${entidade}`,
  authorize: autorizarEntidade,
  run: async ({ entidade }, { userId }) => {
    const { baseUrl, token } = await requireConnection(userId);
    try {
      await callService(baseUrl, token, "scene", "turn_on", { entity_id: entidade });
      return { ativada: true, cena: entidade };
    } catch (e) {
      return { ativada: false, erro: e instanceof HomeAssistantError ? e.message : "Falha ao ativar a cena" };
    }
  },
};

registerTools([
  casa_listar_comodos,
  casa_buscar_dispositivos,
  casa_listar_dispositivos_do_comodo,
  casa_consultar_estado,
  casa_acionar,
  casa_acionar_com_aprovacao,
  casa_ativar_cena,
]);
