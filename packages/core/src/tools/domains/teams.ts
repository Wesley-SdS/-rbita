import { z } from "zod";
import { getAccessToken } from "../../connectors/store";
import { listJoinedTeams, listChannels, listChats, postChannelMessage, postChatMessage } from "../../connectors/microsoft";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: Microsoft Teams. Envio (canal ou chat) passa pelo gate (efeito_externo). */

export const listar_equipes_teams: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "listar_equipes_teams",
  domain: "teams",
  description: "Lista as equipes do Microsoft Teams das quais o usuário participa.",
  risk: "leitura",
  keywords: ["teams", "equipe", "equipes"],
  requires: { connector: "microsoft" },
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const t = await getAccessToken("microsoft", userId);
    if (!t) return { erro: "Microsoft Teams não conectado" };
    return { equipes: await listJoinedTeams(t) };
  },
};

const CanaisInput = z.object({ equipeId: z.string().describe("id da equipe, de listar_equipes_teams") });
export const listar_canais_teams: ToolDef<typeof CanaisInput> = {
  name: "listar_canais_teams",
  domain: "teams",
  description: "Lista os canais de uma equipe do Teams (id de listar_equipes_teams).",
  risk: "leitura",
  keywords: ["teams", "canal", "canais"],
  requires: { connector: "microsoft" },
  inputSchema: CanaisInput,
  run: async ({ equipeId }, { userId }) => {
    const t = await getAccessToken("microsoft", userId);
    if (!t) return { erro: "Microsoft Teams não conectado" };
    return { canais: await listChannels(t, equipeId) };
  },
};

export const listar_conversas_teams: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "listar_conversas_teams",
  domain: "teams",
  description: "Lista as conversas individuais e em grupo (chats) do usuário no Teams, fora dos canais de equipe.",
  risk: "leitura",
  keywords: ["teams", "conversa", "chat", "mensagem direta"],
  requires: { connector: "microsoft" },
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const t = await getAccessToken("microsoft", userId);
    if (!t) return { erro: "Microsoft Teams não conectado" };
    return { conversas: await listChats(t) };
  },
};

const EnviarCanalInput = z.object({
  equipeId: z.string(),
  canalId: z.string(),
  texto: z.string(),
});
export const enviar_teams_canal: ToolDef<typeof EnviarCanalInput> = {
  name: "enviar_teams_canal",
  domain: "teams",
  description: "Propõe postar uma mensagem num canal de equipe do Teams (ids de listar_equipes_teams e listar_canais_teams). Não posta direto: enfileira uma proposta para o usuário aprovar.",
  risk: "efeito_externo",
  keywords: ["teams", "postar", "canal", "avisar equipe"],
  requires: { connector: "microsoft" },
  inputSchema: EnviarCanalInput,
  summarize: ({ canalId, texto }) => `Postar no Teams (canal ${canalId}): "${texto.slice(0, 60)}"`,
  run: async ({ equipeId, canalId, texto }, { userId }) => {
    const t = await getAccessToken("microsoft", userId);
    if (!t) throw new Error("Microsoft Teams não conectado");
    const r = await postChannelMessage(t, equipeId, canalId, texto);
    return `Mensagem postada no canal do Teams (id ${r.id}).`;
  },
};

const EnviarChatInput = z.object({ chatId: z.string(), texto: z.string() });
export const enviar_teams_chat: ToolDef<typeof EnviarChatInput> = {
  name: "enviar_teams_chat",
  domain: "teams",
  description: "Propõe enviar uma mensagem numa conversa (chat 1:1 ou grupo) do Teams (id de listar_conversas_teams). Não envia direto: enfileira uma proposta para o usuário aprovar.",
  risk: "efeito_externo",
  keywords: ["teams", "mensagem", "chat", "conversa"],
  requires: { connector: "microsoft" },
  inputSchema: EnviarChatInput,
  summarize: ({ chatId, texto }) => `Enviar no Teams (chat ${chatId}): "${texto.slice(0, 60)}"`,
  run: async ({ chatId, texto }, { userId }) => {
    const t = await getAccessToken("microsoft", userId);
    if (!t) throw new Error("Microsoft Teams não conectado");
    const r = await postChatMessage(t, chatId, texto);
    return `Mensagem enviada no Teams (id ${r.id}).`;
  },
};

registerTools([listar_equipes_teams, listar_canais_teams, listar_conversas_teams, enviar_teams_canal, enviar_teams_chat]);
