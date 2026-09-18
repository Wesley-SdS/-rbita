import { z } from "zod";
import { registerTools, type ToolContext, type ToolDef } from "../registry";
import { currentGuidedTask, listGuidedTasks, setGuidedStep, startGuidedTask, stopGuidedTask } from "../../guided/task";
import { findCamera } from "../../cameras/query";
import { authorizeRoomForRequester } from "../../home/room-permission";
import { IdentityError } from "../../identity/errors";

/**
 * Domínio ACOMPANHAMENTO (PRD §5.4, "me ajuda com essa receita"): a Órbita
 * guarda os passos, olha a câmera do cômodo de tempos em tempos e avisa o
 * próximo passo quando o atual terminou.
 *
 * O modelo entra só na hora de montar a lista de passos (ele já sabe a receita
 * ou o dono colou o texto). Quem decide quando avançar é a câmera mais a regra
 * pura de `guided/rules.ts`, nunca a conversa.
 */

const quem = async (ctx: ToolContext) => (ctx.requester ? await ctx.requester().catch(() => null) : null);

/** Acompanhar é olhar a câmera daquele cômodo: mesma permissão de ver a câmera. */
const autorizarComodo = async (input: { comodo?: string }, ctx: ToolContext) => {
  const cam = await findCamera(ctx.userId, input.comodo ?? "");
  if (!cam) return null; // câmera inexistente: a própria tool explica
  return authorizeRoomForRequester(cam.roomId, await quem(ctx), "acompanhar uma tarefa pela câmera");
};

const erro = (e: unknown) => ({ erro: e instanceof IdentityError ? e.message : "Não consegui começar o acompanhamento." });

const AcompanharInput = z.object({
  titulo: z.string().min(2).max(120).describe("nome da tarefa, ex.: 'bolo de cenoura'"),
  passos: z.array(z.string().min(2).max(300)).min(1).max(100).describe("os passos em ordem, um por item, curtos e no imperativo"),
  comodo: z.string().min(1).max(60).describe("onde a tarefa acontece, ex.: 'cozinha' (precisa ter câmera)"),
});

export const acompanhar_tarefa: ToolDef<typeof AcompanharInput> = {
  name: "acompanhar_tarefa",
  domain: "acompanhamento",
  description:
    "Acompanha uma tarefa passo a passo pela câmera de um cômodo: a Órbita olha de tempos em tempos e avisa o próximo passo quando o atual terminar. Use para 'me ajuda com essa receita', 'me acompanha nessa montagem'. Monte a lista de passos antes de chamar.",
  risk: "escrita",
  keywords: ["me ajuda com", "receita", "me acompanha", "passo a passo", "vai me guiando"],
  inputSchema: AcompanharInput,
  authorize: autorizarComodo,
  run: async ({ titulo, passos, comodo }, ctx) => {
    try {
      const quemPede = await quem(ctx);
      const t = await startGuidedTask(ctx.userId, { titulo, passos, comodo, personId: quemPede?.personId ?? null });
      return {
        ok: true,
        tarefa: t.title,
        passos: t.steps.length,
        primeiroPasso: t.steps[0] ?? null,
        aviso: `Vou olhar a câmera a cada ${t.intervalSeconds} segundos e avisar quando for a hora do próximo passo. O acompanhamento encerra sozinho em ${Math.round((t.expiresAt.getTime() - Date.now()) / 60000)} minutos, ou quando você mandar parar.`,
      };
    } catch (e) {
      return erro(e);
    }
  },
};

const PararInput = z.object({});
export const parar_acompanhamento: ToolDef<typeof PararInput> = {
  name: "parar_acompanhamento",
  domain: "acompanhamento",
  description: "Encerra o acompanhamento de tarefa que estiver rodando (a Órbita para de olhar a câmera). Use para 'pode parar', 'terminei', 'chega'.",
  risk: "escrita",
  keywords: ["parar de acompanhar", "terminei", "pode parar", "chega"],
  inputSchema: PararInput,
  run: async (_i, ctx) => {
    const t = await stopGuidedTask(ctx.userId, null, "cancelada");
    return t ? { ok: true, tarefa: t.title } : { ok: true, aviso: "Não havia tarefa sendo acompanhada." };
  },
};

const ProximoInput = z.object({});
export const proximo_passo_da_tarefa: ToolDef<typeof ProximoInput> = {
  name: "proximo_passo_da_tarefa",
  domain: "acompanhamento",
  description: "Avança para o próximo passo da tarefa acompanhada, sem esperar a câmera. Use quando a pessoa disser que já terminou o passo atual ('pronto', 'feito', 'próximo').",
  risk: "escrita",
  keywords: ["pronto", "já fiz", "próximo passo", "feito"],
  inputSchema: ProximoInput,
  run: async (_i, ctx) => {
    const atual = await currentGuidedTask(ctx.userId);
    if (!atual) return { aviso: "Não há tarefa sendo acompanhada agora." };
    const t = await setGuidedStep(ctx.userId, atual.id, atual.currentStep + 1);
    if (!t || t.status !== "ativa") return { ok: true, concluiu: true, tarefa: atual.title, resposta: "Era o último passo. Tarefa concluída." };
    return { ok: true, tarefa: t.title, passo: t.currentStep + 1, de: t.steps.length, texto: t.steps[t.currentStep] ?? null };
  },
};

const StatusInput = z.object({});
export const status_da_tarefa: ToolDef<typeof StatusInput> = {
  name: "status_da_tarefa",
  domain: "acompanhamento",
  description: "Diz em que passo está a tarefa que a Órbita está acompanhando, e o que a câmera viu por último. Use para 'em que passo eu estou?', 'o que falta?'.",
  risk: "leitura",
  keywords: ["em que passo", "o que falta", "status da receita", "onde eu parei"],
  inputSchema: StatusInput,
  run: async (_i, ctx) => {
    const [atual] = await listGuidedTasks(ctx.userId, 1);
    if (!atual || atual.status !== "ativa") return { resposta: "Não há tarefa sendo acompanhada agora." };
    return {
      tarefa: atual.titulo,
      passo: atual.passoAtual + 1,
      de: atual.passos.length,
      texto: atual.passos[atual.passoAtual] ?? null,
      faltam: atual.passos.slice(atual.passoAtual + 1),
      // a observação é o que o modelo de visão disse, então é DADO, não verdade
      ultimaObservacao: atual.ultimaObservacao ?? undefined,
      comodo: atual.comodo ?? atual.camera ?? undefined,
    };
  },
};

registerTools([acompanhar_tarefa, parar_acompanhamento, proximo_passo_da_tarefa, status_da_tarefa]);
