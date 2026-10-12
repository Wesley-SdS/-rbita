import { JobPermanentError } from "../jobs/queue";
import type { JobDef, JobRunContext } from "../jobs/registry";
import { events } from "../events/index";
import { log } from "../observability/logger";
import { MaosError } from "../maos/client";
import { saidaParaOModelo } from "./saida";
import { configDoTerminal, executarNasMaos, lerExecucao, pararExecucao, saidaProtegida, type ComandoFixo, type ResumoDaExecucao } from "./servico";

/**
 * O TRABALHO `terminal.comando` (PRD A2): o comando que passou de
 * `terminal.esperarSeg` continua rodando NAS MÃOS, e este trabalho só
 * acompanha. A saída vira progresso (a última linha), o cancelar da tela de
 * trabalhos mata a árvore no Job Object, e no fim sai o evento
 * `terminal.comando_terminado {id, codigo, duracao}` (que regra pode usar:
 * "me avisa quando o build acabar") e o aviso ao dono.
 *
 * O modo isolado pelo Windows Sandbox nasce aqui direto: o Sandbox só devolve
 * no fim, e isso não cabe numa requisição.
 */

export const EVENTO_TERMINADO = "terminal.comando_terminado";

const ultimaLinha = (s: string) =>
  (s ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
    ?.slice(0, 160) ?? "";

async function esperar(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function acompanhar(ctx: JobRunContext, id: string, intervaloMs = 2000): Promise<ResumoDaExecucao> {
  let falhas = 0;
  for (;;) {
    if (await ctx.cancelado()) {
      const r = await pararExecucao(id).catch(() => null);
      throw new JobPermanentError(`Cancelado: o comando foi encerrado${r ? ` depois de ${Math.round(r.duracaoMs / 1000)} s` : ""}.`);
    }
    let r: ResumoDaExecucao;
    try {
      r = await lerExecucao(id);
      falhas = 0;
    } catch (e) {
      // 404: as mãos reiniciaram, e o Job Object levou o comando junto
      if (e instanceof MaosError && e.status === 404) throw new JobPermanentError("As mãos do Windows reiniciaram e o comando foi encerrado junto com elas.");
      if (++falhas >= 15) throw e;
      await esperar(intervaloMs);
      continue;
    }
    if (r.terminou) return r;
    await ctx.progresso(Math.round(r.duracaoMs / 1000), null, ultimaLinha(r.saida) || "rodando");
    await esperar(intervaloMs);
  }
}

export const comandoNoTerminal: JobDef = {
  kind: "terminal.comando",
  title: (p) => `Rodar no terminal: ${String(p.comando ?? "").slice(0, 80)}`,
  // comando não se repete sozinho: rodar `pnpm install` duas vezes porque a primeira "falhou" não é retentar
  maxAttempts: 1,
  run: async (ctx) => {
    const p = ctx.payload as Partial<ComandoFixo> & { execId?: string; avisar?: boolean };
    if (!p.comando || !p.shell || !p.pasta) throw new JobPermanentError("Pedido de comando incompleto.");
    const cfg = await configDoTerminal();
    let r: ResumoDaExecucao;
    if (p.execId) {
      r = await acompanhar(ctx, p.execId);
    } else {
      await ctx.progresso(0, null, "rodando isolado");
      r = await executarNasMaos({ comando: p.comando, shell: p.shell, pasta: p.pasta, isolado: true }, cfg.timeoutMaxSeg, cfg);
      if (r.id && !r.terminou) r = await acompanhar(ctx, r.id);
    }
    const mascara = { arquivoDeAmbiente: await saidaProtegida({ comando: p.comando, shell: p.shell, pasta: p.pasta }, cfg) };
    const dados = { id: r.id ?? p.execId ?? null, codigo: r.codigo, duracao: Math.round(r.duracaoMs / 1000), comando: p.comando.slice(0, 200), status: r.status };
    await events.emit(EVENTO_TERMINADO, dados, { userId: ctx.userId });
    if (p.avisar !== false) {
      const { notifyUser } = await import("../routines/run");
      const deuCerto = r.status === "terminou" && r.codigo === 0;
      const titulo = deuCerto ? "Comando terminou" : r.status === "tempo_esgotado" ? "Comando passou do tempo" : "Comando terminou com erro";
      await notifyUser(ctx.userId, titulo, `\`${p.comando.slice(0, 120)}\` ${deuCerto ? "terminou bem" : `saiu com ${r.status === "terminou" ? `código ${r.codigo}` : r.motivo ?? r.status}`} em ${dados.duracao} s. Final da saída: ${ultimaLinha(saidaParaOModelo(r.saida, 2000, undefined, mascara)) || "(nada)"}`, null, { origem: "sistema", whatsapp: true }).catch((e) =>
        log.warn("terminal.aviso_falhou", { erro: e instanceof Error ? e.message : String(e) }),
      );
    }
    return { ...dados, saida: saidaParaOModelo(r.saida, 4000, undefined, mascara) };
  },
};
