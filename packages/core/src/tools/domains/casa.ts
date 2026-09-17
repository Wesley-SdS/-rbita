import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { room } from "@orbita/db/home-schema";
import { getHaConnection } from "../../home/connection";
import { callService, HomeAssistantError } from "../../home/client";
import { entitiesInRoom, findEntities, type EntityHit } from "../../home/entities";
import { domainOf, resolveDomainRisk } from "../../home/domain-risk";
import { loadDomainRiskOverrides } from "../../home/access";
import { registerTools, needsApproval, type ToolDef } from "../registry";

/**
 * Tools COMPOSTAS da casa (B3.5): listar, consultar, acionar, cena — nunca
 * uma tool por entidade (centenas de luzes não cabem no contexto do modelo).
 *
 * O risco de ACIONAR depende do DOMÍNIO da entidade alvo (B3.8), que só se
 * sabe em tempo de execução — mas o gate humano (§5.1) é derivado do risco
 * DECLARADO da tool, antes de rodar. Por isso duas tools, não uma:
 * `casa_acionar` (declarada "escrita", roda direto) recusa e não executa se o
 * domínio real da entidade for perigoso; `casa_acionar_com_aprovacao`
 * (declarada "perigoso") sempre passa pelo gate. Nenhuma dá para "burlar" —
 * a primeira se recusa, a segunda sempre pede aprovação, mesmo que o domínio
 * real seja inofensivo.
 */

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

const RoomInput = z.object({ comodoId: z.string().uuid() });
export const casa_listar_dispositivos_do_comodo: ToolDef<typeof RoomInput> = {
  name: "casa_listar_dispositivos_do_comodo",
  domain: "casa",
  description: "Lista todos os dispositivos de um cômodo (id vindo de casa_listar_comodos). Use para 'apaga tudo da sala' ou para ver o que existe num cômodo.",
  risk: "leitura",
  requires: { homeAssistant: true },
  keywords: ["comodo", "sala", "quarto", "tudo", "dispositivos"],
  inputSchema: RoomInput,
  run: async ({ comodoId }, { userId }) => {
    const hits = await entitiesInRoom(userId, comodoId);
    return { dispositivos: hits.map(fmt) };
  },
};

const EstadoInput = z.object({ entidade: z.string().describe("entity_id do Home Assistant, ex.: light.sala") });
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

const AcionarInput = z.object({
  entidade: z.string().describe("entity_id alvo, ex.: light.sala, climate.quarto"),
  servico: z.string().describe('ação do domínio, ex.: "turn_on", "turn_off", "set_temperature"'),
  dados: z.record(z.string(), z.unknown()).optional().describe('parâmetros extras do serviço, ex.: {"temperature": 22}'),
});

async function runAcionar(input: z.infer<typeof AcionarInput>, userId: string) {
  const { baseUrl, token } = await requireConnection(userId);
  const domain = domainOf(input.entidade);
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
  summarize: ({ entidade, servico }) => `Acionar ${entidade}: ${servico}`,
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
  summarize: ({ entidade, servico }) => `Acionar (segurança) ${entidade}: ${servico}`,
  run: async (input, { userId }) => runAcionar(input, userId),
};

const CenaInput = z.object({ entidade: z.string().describe("entity_id da cena, ex.: scene.boa_noite") });
export const casa_ativar_cena: ToolDef<typeof CenaInput> = {
  name: "casa_ativar_cena",
  domain: "casa",
  description: "Ativa uma cena do Home Assistant (um conjunto de ajustes pré-configurado pelo dono, ex.: 'boa noite', 'modo cinema'). A cena em si só ajusta dispositivos diretos; se o dono configurou algo de segurança dentro dela no próprio HA, isso é responsabilidade do HA, não desta tool.",
  risk: "escrita",
  requires: { homeAssistant: true },
  keywords: ["cena", "modo", "boa noite", "cinema", "ambiente"],
  inputSchema: CenaInput,
  summarize: ({ entidade }) => `Ativar cena ${entidade}`,
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
