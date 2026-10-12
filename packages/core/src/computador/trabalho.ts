import { chamarClaudeDireto, claudeDiretoDisponivel } from "@orbita/llm";
import { registerJobs, type JobDef, type JobRunContext } from "../jobs/registry";
import { JobPermanentError } from "../jobs/queue";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { FLUXO, registrarUso } from "../usage/registrar";
import { pausarSessao, sessaoPorId } from "../controle/sessao";
import { esperarAprovacaoNaFila } from "../navegador/trabalho";
import { rodarTarefa, type CfgDoComputador, type DependenciasDoComputador, type EstadoDaSessao, type ResultadoDaTarefa } from "./motor";
import { rodarComModeloDaCasa } from "./motor-orbita";
import { janelasAbertas } from "./servico";

/**
 * A TAREFA DELEGADA NO WINDOWS vira trabalho da fila (CLAUDE.md §6: mais de ~10 s
 * não roda dentro da requisição). A tool `computador_tarefa` só enfileira e
 * responde "comecei"; o laço roda aqui, com progresso na tela, e avisa o dono ao
 * terminar, ao parar numa aprovação e ao precisar dele.
 *
 * UMA tentativa só: ação no desktop não é idempotente, e repetir uma tarefa pela
 * metade clicaria duas vezes no mesmo botão. Se o processo cai no meio, a
 * recuperação de zumbi desiste do trabalho (maxAttempts 1) em vez de devolvê-lo à
 * fila: nada é repetido, e a trilha mostra até onde foi.
 */

const texto = (p: Record<string, unknown>, k: string): string => (typeof p[k] === "string" ? (p[k] as string) : "");
const CANAIS = ["tela", "voz", "whatsapp", "telegram"] as const;
type Canal = (typeof CANAIS)[number];

/** Com que frequência o "parar" do dono corta a chamada ao Claude em andamento. */
const SONDA_DE_PARADA_MS = 250;

export interface PedidoDaTarefa {
  userId: string;
  objetivo: string;
  sessaoId: string;
  canal: Canal;
  pedido: string;
  cancelado: JobRunContext["cancelado"];
  progresso: JobRunContext["progresso"];
}

/** As mãos e o modelo de verdade do laço delegado (os testes trocam só o Claude e a espera). */
export async function dependenciasDaTarefa(p: PedidoDaTarefa): Promise<{ deps: DependenciasDoComputador; cfg: CfgDoComputador; encerrar: () => void }> {
  const { userId, canal, pedido } = p;
  const cfg = await settings.getMany([
    "computador.motor", "computador.modeloMotor", "computador.escalarParaOpus", "computador.passosPorTarefa", "computador.capturasNoContexto", "computador.contextoMaxTokens", "computador.tokensPorTarefa",
    "controle.capturaParaNuvem", "computador.esperaAprovacaoMin", "computador.pausaEntrePassosMs", "computador.pausaMaxMs", "computador.esperaAbrirMs", "computador.travadoSeg", "chat.maxSteps",
  ]);
  const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const estadoDaSessao = async (): Promise<EstadoDaSessao> => {
    const s = await sessaoPorId(userId, p.sessaoId).catch(() => null);
    return s ? (s.status as EstadoDaSessao) : "sumiu";
  };
  const { executarPeloRegistro } = await import("../tools/index");
  const { notifyUser } = await import("../routines/run");

  // O "parar" (atalho, botão, "para" na voz) marca a sessão; esta sonda corta a chamada ao Claude
  // em andamento em vez de esperar a resposta terminar. Sem isto o laço só perceberia na volta seguinte.
  const aborto = new AbortController();
  const sonda = setInterval(() => {
    void (async () => {
      if (aborto.signal.aborted) return;
      if ((await p.cancelado().catch(() => false)) || (await estadoDaSessao()) !== "ativa") aborto.abort();
    })();
  }, SONDA_DE_PARADA_MS);
  sonda.unref?.();

  const modelo = cfg["computador.modeloMotor"];
  const deps: DependenciasDoComputador = {
    chamarClaude: chamarClaudeDireto,
    tool: (nome, entrada) => executarPeloRegistro(userId, nome, entrada, { canal, pedido }),
    esperarAprovacao: (acaoId, prazoMs) => esperarAprovacaoNaFila(userId, acaoId, prazoMs, dormir, async () => (await p.cancelado()) || (await estadoDaSessao()) !== "ativa"),
    estadoDaSessao,
    cancelado: p.cancelado,
    avisar: (titulo, t) => notifyUser(userId, titulo, t, null, { origem: "sistema", destino: "/app/ajustes?aba=controle" }),
    dormir,
    progresso: p.progresso,
    pausarSessao: async (motivo) => void (await pausarSessao(userId, p.sessaoId, motivo)),
    janelas: async () => (await janelasAbertas()).map((j) => ({ janela: j.janela, app: j.app || j.exe, nomes: j.nomes, foco: j.foco, minimizada: j.minimizada, elevada: j.elevada, oculta: j.oculta })),
    sinal: aborto.signal,
    registrarUso: (u, m) =>
      registrarUso({
        userId,
        fluxo: FLUXO.computador,
        referencia: "tarefa",
        modelKey: m.startsWith("claude/") ? m : `claude/${m}`,
        consumo: { unidade: "tokens", entrada: u.input_tokens + (u.cache_creation_input_tokens ?? 0), saida: u.output_tokens, entradaCache: u.cache_read_input_tokens ?? 0 },
      }),
    motorDaOrbita: async (objetivo, contexto) => {
      const { buildToolSet } = await import("../tools/index");
      const { gerarTexto } = await import("../llm/gerar");
      return rodarComModeloDaCasa(
        { objetivo, contexto, maxSteps: cfg["chat.maxSteps"] },
        {
          montarTools: () => buildToolSet(userId, objetivo, undefined, undefined, undefined, ["computador"], canal, false, true, { pedido }),
          gerar: async (a) => (await gerarTexto({ userId, fluxo: FLUXO.computador, referencia: "tarefa", system: a.system, prompt: a.prompt, tools: a.tools as never, maxSteps: a.maxSteps })).texto,
        },
      );
    },
  };
  const sessao = await sessaoPorId(userId, p.sessaoId).catch(() => null);
  return {
    deps,
    encerrar: () => clearInterval(sonda),
    cfg: {
      modelo,
      modeloEscalada: "claude/claude-opus-5-5",
      escalarParaOpus: cfg["computador.escalarParaOpus"],
      // o screenshot vai inteiro à nuvem: com a chave do dono desligada, só as tools da Órbita (árvore de acessibilidade, modelo da casa)
      usarClaude: cfg["computador.motor"] === "claude" && cfg["controle.capturaParaNuvem"] && claudeDiretoDisponivel(),
      passosMax: cfg["computador.passosPorTarefa"],
      capturas: cfg["computador.capturasNoContexto"],
      contextoMaxTokens: cfg["computador.contextoMaxTokens"],
      tokensMax: cfg["computador.tokensPorTarefa"],
      esperaAprovacaoMs: cfg["computador.esperaAprovacaoMin"] * 60_000,
      pausaEntrePassosMs: cfg["computador.pausaEntrePassosMs"],
      pausaMaxMs: cfg["computador.pausaMaxMs"],
      esperaAbrirMs: cfg["computador.esperaAbrirMs"],
      travadoMs: cfg["computador.travadoSeg"] * 1000,
      apps: sessao?.apps ?? [],
    },
  };
}

export const tarefaNoComputador: JobDef = {
  kind: "computador.tarefa",
  title: (p) => `Windows: ${texto(p, "objetivo").slice(0, 80) || "tarefa"}`,
  maxAttempts: 1,
  run: async (ctx) => {
    const objetivo = texto(ctx.payload, "objetivo");
    const sessaoId = texto(ctx.payload, "sessaoId");
    if (!objetivo || !sessaoId) throw new JobPermanentError("Tarefa do Windows sem objetivo ou sem sessão.");
    const canalBruto = texto(ctx.payload, "canal");
    const canal: Canal = (CANAIS as readonly string[]).includes(canalBruto) ? (canalBruto as Canal) : "tela";
    const pedido = texto(ctx.payload, "pedido") || objetivo;
    const { deps, cfg, encerrar } = await dependenciasDaTarefa({ userId: ctx.userId, objetivo, sessaoId, canal, pedido, cancelado: ctx.cancelado, progresso: ctx.progresso });
    let r: ResultadoDaTarefa;
    try {
      r = await rodarTarefa({ objetivo, pedido }, deps, cfg);
    } finally {
      encerrar();
    }
    log.info("computador.tarefa_fim", { userId: ctx.userId, estado: r.estado, motor: r.motor, tokens: r.tokens, acoes: r.acoes });
    const titulo = r.estado === "concluida" ? "Terminei a tarefa no Windows" : "A tarefa no Windows parou";
    await deps.avisar(titulo, `${objetivo}\n\n${r.resumo}`).catch(() => undefined);
    return { ...r };
  },
};

registerJobs([tarefaNoComputador]);
