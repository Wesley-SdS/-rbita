import { z } from "zod";
import { getAccessToken } from "../../connectors/store";
import { listChannels, postMessage } from "../../connectors/slack";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: Slack. `enviar_slack` passa pelo gate (efeito_externo). */

export const listar_canais_slack: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "listar_canais_slack",
  domain: "slack",
  description: "Lista os canais públicos do Slack do usuário (id + nome).",
  risk: "leitura",
  keywords: ["slack", "canal", "canais"],
  requires: { connector: "slack" },
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const t = await getAccessToken("slack", userId);
    if (!t) return { erro: "Slack não conectado" };
    return { canais: await listChannels(t) };
  },
};

const Input = z.object({ canal: z.string(), texto: z.string() });
export const enviar_slack: ToolDef<typeof Input> = {
  name: "enviar_slack",
  domain: "slack",
  description: "Propõe postar uma mensagem num canal do Slack (id do canal de listar_canais_slack). Não posta direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
  risk: "efeito_externo",
  keywords: ["slack", "postar", "mensagem", "canal", "avisar time"],
  requires: { connector: "slack" },
  inputSchema: Input,
  summarize: ({ canal, texto }) => `Postar no Slack (${canal}): "${texto.slice(0, 60)}"`,
  run: async ({ canal, texto }, { userId }) => {
    const t = await getAccessToken("slack", userId);
    if (!t) throw new Error("Slack não conectado");
    const r = await postMessage(t, canal, texto);
    return `Mensagem postada no Slack (ts ${r.ts}).`;
  },
};

registerTools([listar_canais_slack, enviar_slack]);
