import { db } from "@orbita/db";
import { usageEvent } from "@orbita/db/usage-schema";
import { log } from "../observability/logger";
import { custoDaChamada, precoDoModelo, precoDoServico, type Consumo } from "./custo";

/**
 * O ponto por onde TODO gasto da casa passa.
 *
 * Regra de ouro deste arquivo: registrar nunca pode derrubar o que estava
 * sendo feito. Se a contabilidade falhar, a reunião continua resumida e o
 * e-mail continua lido — perde-se a linha na conta, não o trabalho. Por isso
 * tudo aqui é best-effort e nada é aguardado por quem chama.
 */

/** O nome do fluxo é o que a tela de gestão agrupa. Constante para não virar sopa de string. */
export const FLUXO = {
  chat: "chat",
  rotina: "rotina",
  regra: "regra",
  resumoConversa: "resumo_conversa",
  resumoReuniao: "resumo_reuniao",
  compromissos: "compromissos",
  transcricao: "transcricao",
  transcricaoViva: "transcricao_viva",
  vozTempoReal: "voz_tempo_real",
  ocr: "ocr",
  visao: "visao",
  camera: "camera",
  embedding: "embedding",
  tts: "tts",
  memoria: "memoria",
  financas: "financas",
  casa: "casa",
  acompanhamento: "acompanhamento",
} as const;

export interface RegistroDeUso {
  userId: string;
  fluxo: string;
  /** o id da rotina, o nome do arquivo: o que ajuda a entender a linha depois */
  referencia?: string | null;
  /** chave `provider/id` do catálogo, para gasto de modelo de texto */
  modelKey?: string;
  /** nome do serviço (`assemblyai`, `piper`, `gemini-tts`…), para o resto */
  servico?: string;
  consumo: Consumo;
  duracaoMs?: number;
  erro?: string | null;
}

/**
 * Grava uma chamada na conta da casa.
 *
 * Não devolve promessa de propósito: quem chama não deve esperar por isto nem
 * tratar erro daqui. O `void` é intencional e o `catch` engole com log.
 */
export function registrarUso(r: RegistroDeUso): void {
  void gravar(r).catch((e) => log.warn("uso.nao_registrado", { fluxo: r.fluxo, error: e instanceof Error ? e.message : String(e) }));
}

async function gravar(r: RegistroDeUso): Promise<void> {
  const deModelo = Boolean(r.modelKey);
  const { preco, cobranca } = deModelo ? precoDoModelo(r.modelKey!) : precoDoServico(r.servico ?? "");
  const custoUsd = custoDaChamada(r.consumo, preco, cobranca);

  await db.insert(usageEvent).values({
    userId: r.userId,
    fluxo: r.fluxo,
    referencia: r.referencia ?? null,
    provider: deModelo ? (r.modelKey!.split("/")[0] ?? "desconhecido") : (r.servico ?? "desconhecido"),
    modelo: deModelo ? r.modelKey! : (r.servico ?? "desconhecido"),
    unidade: r.consumo.unidade,
    entrada: Math.round(r.consumo.entrada) || 0,
    saida: Math.round(r.consumo.saida) || 0,
    entradaCache: Math.round(r.consumo.entradaCache ?? 0) || 0,
    custoUsd,
    cobranca,
    duracaoMs: r.duracaoMs ?? null,
    erro: r.erro ?? null,
  });
}
