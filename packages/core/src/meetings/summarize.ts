import { generateText } from "ai";
import { z } from "zod";
import { modeloDaCasa } from "../llm/gerar";
import { registrarUso, FLUXO } from "../usage/registrar";
import type { RelatoDeUso } from "./structured";
import { ingestDocument } from "../rag/ingest";
import { chunkText } from "../rag/chunk";
import { dedupeCompromissos, type Compromisso } from "./compromissos";
import { generateStructured } from "./structured";
import { settings } from "../settings";
import { log } from "../observability/logger";
// pela fachada: este módulo manda a transcrição para o modelo, que pode ser de
// nuvem, e a cerca do NV.1 não deixa ele importar o módulo de voz
import { ligarDesconhecidosAReuniao } from "../identity/actions";
import { isOwner } from "../owner";

/**
 * Resumo de reunião (MTG.2 e MTG.3). Saiu da rota para cá quando virou trabalho
 * de fila: uma reunião longa é mapa-redução com uma chamada de LLM por bloco, o
 * que leva minutos e não cabe dentro de uma requisição HTTP.
 *
 * O `progresso` existe para a tela dizer "bloco 3 de 12" em vez de parecer
 * travada, e é opcional: quem chamar sem ele continua funcionando igual.
 */

export type Progresso = (feito: number, total: number | null, passo: string) => Promise<void>;

const CompromissoSchema = z.object({
  descricao: z.string().max(300),
  responsavel: z.string().max(120).optional().describe('quem se comprometeu (o nome, "Locutor A", ou vazio se não ficou claro)'),
  prazo: z.string().max(60).optional().describe("prazo mencionado, em ISO (AAAA-MM-DD) se houver data explícita; vazio se não houver"),
});
const ExtractionSchema = z.object({
  resumo: z.string().describe("resumo em markdown com as seções: Resumo, Pontos principais, Decisões, Ações"),
  // .catch([]): modelos locais pequenos às vezes esquecem este campo ou mandam
  // formato levemente errado. Um resumo bom não deve ser jogado fora só porque
  // a extração de compromissos falhou.
  compromissos: z.array(CompromissoSchema).max(20).catch([]),
});

const REGRAS_LOCUTOR =
  'Quando a transcrição vier marcada com "Locutor A/B/C", use esses rótulos para atribuir falas, ' +
  'decisões e ações. Não invente o NOME real de ninguém: se não souber quem é o Locutor A, escreva "Locutor A". ' +
  "Seja fiel à transcrição; não invente.";

const SINGLE_PASS_PROMPT =
  "Você é a ÓRBITA. Analise a transcrição de reunião a seguir, em português do Brasil.\n" +
  "No campo `resumo`, escreva markdown com:\n1. **Resumo** (2-3 frases).\n2. **Pontos principais** (bullets).\n3. **Decisões**.\n4. **Ações** (quem faz o quê, se houver).\n" +
  `${REGRAS_LOCUTOR}\n` +
  "No campo `compromissos`, extraia cada promessa ou ação combinada (\"vou mandar o relatório amanhã\", \"o cliente confirma até sexta\") " +
  "como um item separado, com responsável e prazo quando ficarem claros. Não invente prazo que não foi dito.\n\nTranscrição:\n\n";

const CHUNK_PROMPT =
  "Você é a ÓRBITA. Esta é uma PARTE de uma reunião mais longa (não o início nem necessariamente o fim). " +
  "Resuma só este trecho no campo `resumo` (pontos principais, decisões e ações deste trecho, em bullets curtos) " +
  `e extraia os compromissos deste trecho no campo \`compromissos\`. ${REGRAS_LOCUTOR}\n\nTrecho da transcrição:\n\n`;

const REDUCE_PROMPT =
  "Você é a ÓRBITA. Abaixo estão os resumos PARCIAIS de uma reunião longa, na ordem em que aconteceram, " +
  "cada um cobrindo um trecho diferente da mesma conversa. Escreva o resumo FINAL, único e coeso, em português do Brasil, com:\n" +
  "1. **Resumo** (3-5 frases cobrindo a reunião inteira).\n2. **Pontos principais** (bullets, sem repetir o que é a mesma coisa dita em trechos diferentes).\n" +
  "3. **Decisões**.\n4. **Ações** (quem faz o quê).\nNão invente nada que não esteja nos resumos parciais:\n\n";

/** Engenharia (não é decisão do dono): teto de blocos para uma configuração
 *  extrema de `meetings.mapChunkChars` não gerar dezenas de chamadas ao LLM
 *  em série por uma transcrição patológica. Ajusta o tamanho do bloco para
 *  caber no teto em vez de recusar. */
const MAX_CHUNKS = 40;

type Modelo = Awaited<ReturnType<typeof modeloDaCasa>>["model"];

async function extractStructured(model: Modelo, prompt: string, aoUsar?: RelatoDeUso): Promise<{ resumo: string; compromissos: Compromisso[] }> {
  return generateStructured(model, prompt, ExtractionSchema, aoUsar);
}

/** Resumo em passada única (transcrição cabe no orçamento configurado). */
async function summarizeSinglePass(model: Modelo, transcript: string, aoUsar?: RelatoDeUso) {
  const { resumo, compromissos } = await extractStructured(model, SINGLE_PASS_PROMPT + transcript, aoUsar);
  return { summary: resumo.trim(), compromissos: dedupeCompromissos(compromissos) };
}

/** Resumo em mapa-redução (MTG.3): resume cada bloco, depois consolida. */
async function summarizeMapReduce(model: Modelo, transcript: string, chunkChars: number, progresso?: Progresso, aoUsar?: RelatoDeUso) {
  const efetivo = Math.ceil(transcript.length / MAX_CHUNKS) > chunkChars ? Math.ceil(transcript.length / MAX_CHUNKS) : chunkChars;
  const blocos = chunkText(transcript, efetivo, Math.min(300, efetivo - 1));

  const parciais: { resumo: string; compromissos: Compromisso[] }[] = [];
  for (const [i, bloco] of blocos.entries()) {
    // o progresso é também o sinal de vida do trabalho na fila: sem ele, um
    // mapa-redução de vários minutos seria confundido com trabalho travado
    await progresso?.(i, blocos.length + 1, `resumindo o bloco ${i + 1} de ${blocos.length}`);
    parciais.push(await extractStructured(model, CHUNK_PROMPT + bloco, aoUsar));
  }

  await progresso?.(blocos.length, blocos.length + 1, "juntando os resumos parciais");
  const combinado = parciais.map((p, i) => `### Trecho ${i + 1}\n${p.resumo}`).join("\n\n");
  const { text, usage } = await generateText({ model, prompt: REDUCE_PROMPT + combinado });
  aoUsar?.(usage ?? {});

  return { summary: text.trim(), compromissos: dedupeCompromissos(parciais.flatMap((p) => p.compromissos)), blocos: blocos.length };
}

export interface SummarizeInput {
  transcript: string;
  title?: string;
  /** rótulos "Desconhecido N" desta transcrição, para ligar à reunião (Onda 9) */
  desconhecidos?: string[];
}

export interface SummarizeResult {
  title: string;
  summary: string;
  compromissos: Compromisso[];
  documentId: string | null;
  archived: boolean;
  blocos: number;
}

export async function summarizeMeeting(userId: string, input: SummarizeInput, progresso?: Progresso): Promise<SummarizeResult> {
  const cfg = await settings.getMany(["limits.summaryMaxChars", "meetings.mapChunkChars"]);
  const { transcript } = input;
  const title = input.title?.trim() || `Reunião ${new Date().toLocaleString("pt-BR")}`;
  const started = Date.now();
  const { model, modelKey } = await modeloDaCasa();

  // o resumo faz de 1 a 40 chamadas com o mesmo modelo; a conta soma todas e
  // grava UMA linha, senão a tela de gestão viraria uma lista de fragmentos
  let entrada = 0;
  let saida = 0;
  let cache = 0;
  const aoUsar: RelatoDeUso = (u) => {
    entrada += u.inputTokens ?? 0;
    saida += u.outputTokens ?? 0;

  };

  let summary: string;
  let compromissos: Compromisso[];
  let blocos = 1;
  if (transcript.length <= cfg["limits.summaryMaxChars"]) {
    await progresso?.(0, 2, "resumindo a reunião");
    ({ summary, compromissos } = await summarizeSinglePass(model, transcript, aoUsar));
  } else {
    const r = await summarizeMapReduce(model, transcript, cfg["meetings.mapChunkChars"], progresso, aoUsar);
    summary = r.summary;
    compromissos = r.compromissos;
    blocos = r.blocos;
  }

  // arquiva transcrição + resumo + compromissos no RAG (fica pesquisável e vira contexto do chat)
  await progresso?.(blocos, blocos + 1, "arquivando na memória");
  const compromissosMd = compromissos.length
    ? "\n\n## Compromissos\n" + compromissos.map((c) => `- ${c.descricao}${c.responsavel ? ` (${c.responsavel})` : ""}${c.prazo ? ` (prazo ${c.prazo})` : ""}`).join("\n")
    : "";
  const doc = `# ${title}\n\n## Resumo\n${summary}${compromissosMd}\n\n## Transcrição\n${transcript}`;
  const res = await ingestDocument(userId, title, doc, "meeting").catch(() => ({ chunks: 0, documentId: null as string | null }));

  log.info("meeting.summarize", { userId, ms: Date.now() - started, chars: transcript.length, blocos, compromissos: compromissos.length, chunks: res.chunks });
  registrarUso({
    userId,
    fluxo: FLUXO.resumoReuniao,
    referencia: title,
    modelKey,
    consumo: { unidade: "tokens", entrada, saida, entradaCache: cache },
    duracaoMs: Date.now() - started,
  });

  // fail-soft: o resumo não pode falhar porque o vínculo de um desconhecido falhou
  if (res.documentId && input.desconhecidos?.length && (await isOwner(userId))) {
    await ligarDesconhecidosAReuniao(userId, input.desconhecidos, res.documentId).catch((e) =>
      log.warn("meeting.vinculo_desconhecido_falhou", { error: e instanceof Error ? e.message : String(e) }),
    );
  }

  return { title, summary, compromissos, documentId: res.documentId, archived: res.chunks > 0, blocos };
}
