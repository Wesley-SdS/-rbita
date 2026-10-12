import path from "node:path";
import { JobPermanentError } from "../jobs/queue";
import type { JobDef } from "../jobs/registry";
import { log } from "../observability/logger";
import { CaminhoRecusado } from "./guarda";
import { extrairArquivo } from "./operacoes";

/**
 * O TRABALHO `arquivo.ler` (PRD A4 com a C3): um arquivo do PC que demora para
 * ler (PDF escaneado longo, áudio de meia hora) sai da requisição e vira
 * trabalho. O texto fica no cache da leitura (mesmo processo), então a próxima
 * pergunta sobre o arquivo é instantânea, e o dono é avisado.
 */
export const lerArquivoDoPc: JobDef = {
  kind: "arquivo.ler",
  title: (p) => `Ler o arquivo "${path.win32.basename(String(p.caminho ?? "arquivo"))}"`,
  maxAttempts: 1,
  run: async (ctx) => {
    const caminho = String(ctx.payload.caminho ?? "");
    if (!caminho) throw new JobPermanentError("Pedido de leitura sem caminho.");
    try {
      const l = await extrairArquivo(caminho, ctx.userId, undefined, (feito, total, passo) => ctx.progresso(feito, total, passo));
      const { notifyUser } = await import("../routines/run");
      await notifyUser(ctx.userId, "Terminei de ler o arquivo", `${path.win32.basename(l.caminho)}: ${l.resumo}. Pode perguntar o que quiser sobre ele.`, null, { origem: "sistema", whatsapp: true }).catch((e) =>
        log.warn("arquivos.aviso_falhou", { erro: e instanceof Error ? e.message : String(e) }),
      );
      return { caminho: l.caminho, tipo: l.tipo, resumo: l.resumo, caracteres: l.textoInteiro.length };
    } catch (e) {
      if (e instanceof CaminhoRecusado) throw new JobPermanentError(e.message);
      throw e;
    }
  },
};
