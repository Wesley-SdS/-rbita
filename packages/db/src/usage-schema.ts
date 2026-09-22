import { pgTable, text, timestamp, uuid, real, integer, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * TODO consumo pago da Órbita, num lugar só.
 *
 * Existe por uma medição constrangedora de 22/09/2026: o painel de economia
 * mostrava 136 tokens enquanto a casa tinha acabado de fazer 356 chamadas de
 * modelo. O resumo lia a tabela `message`, e só o chat escreve ali — então
 * tudo que a Órbita faz SOZINHA (rotina, regra, resumo de reunião, OCR,
 * transcrição, embedding, voz) era invisível. O que gasta sem ninguém ver é
 * justamente o que precisa ser visto.
 *
 * Uma linha por chamada. Não é log: é contabilidade, e é dela que a tela de
 * gestão tira "quanto a rotina X me custou neste mês".
 */
export const usageEvent = pgTable(
  "usage_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * QUEM gastou, em termos de produto: "chat", "rotina", "regra",
     * "resumo_reuniao", "transcricao", "ocr", "visao", "embedding", "tts",
     * "memoria", "financas", "voz_tempo_real"…
     *
     * Texto livre e não enum de propósito: fluxo novo não deve depender de
     * migração para aparecer na conta. A tela agrupa pelo que encontrar.
     */
    fluxo: text("fluxo").notNull(),
    /** Detalhe opcional dentro do fluxo (o id da rotina, o nome do documento). */
    referencia: text("referencia"),

    provider: text("provider").notNull(), // claude | gateway | google | openai | local | assemblyai | piper…
    modelo: text("modelo").notNull(),

    /**
     * A UNIDADE importa porque nem tudo é token: transcrição cobra por
     * segundo de áudio, TTS por caractere, OCR por página. Somar tudo como
     * "tokens" daria um número que não quer dizer nada.
     */
    unidade: text("unidade").notNull(), // tokens | segundos | caracteres | paginas | requisicoes
    entrada: integer("entrada").notNull().default(0),
    saida: integer("saida").notNull().default(0),
    /** Entrada que veio de cache do provedor (cobra menos, quando cobra). */
    entradaCache: integer("entrada_cache").notNull().default(0),

    /**
     * Custo estimado em USD. É ESTIMATIVA, e assumida como tal: sai do preço
     * que o provedor informou na descoberta, que pode mudar sem aviso. Quem
     * paga por assinatura registra 0 aqui e aparece na tela como "coberto
     * pela assinatura" — porque custo zero por chamada não é custo zero.
     */
    custoUsd: real("custo_usd").notNull().default(0),
    /** Como o gasto é cobrado: `assinatura`, `uso`, `local` (só energia) ou `gratis`. */
    cobranca: text("cobranca").notNull().default("uso"),

    /** Quanto demorou, para a tela poder mostrar lentidão junto do custo. */
    duracaoMs: integer("duracao_ms"),
    /** Falhou? Uma tentativa que falhou depois do primeiro token também custa. */
    erro: text("erro"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // a tela de gestão sempre lê "deste usuário, neste período"
    index("usage_event_user_created").on(t.userId, t.createdAt),
    index("usage_event_fluxo").on(t.userId, t.fluxo),
  ],
);
