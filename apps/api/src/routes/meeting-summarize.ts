// Reescrita para a Onda 2 (MTG.2 extração de compromissos, MTG.3 mapa-redução).
// Origem em paridade: apps/web/src/app/api/meeting/summarize/route.ts (Onda 1).
import { generateText } from "ai";
import { z } from "zod";
import { resolveModel, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { ingestDocument } from "@orbita/core/rag/ingest";
import { chunkText } from "@orbita/core/rag/chunk";
import { dedupeCompromissos, type Compromisso } from "@orbita/core/meetings/compromissos";
import { generateStructured } from "@orbita/core/meetings/structured";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { log } from "@orbita/core/observability/logger";
import { settings } from "@orbita/core/settings/index";

const Body = z.object({
  // teto alto: a transcrição INTEIRA é arquivada no RAG (o corte abaixo decide
  // só entre resumo em passada única ou mapa-redução). ~500k chars cobre uma
  // reunião de várias horas.
  transcript: z.string().min(1).max(500000),
  title: z.string().max(200).optional(),
});

const CompromissoSchema = z.object({
  descricao: z.string().max(300),
  responsavel: z.string().max(120).optional().describe('quem se comprometeu (o nome, "Locutor A", ou vazio se não ficou claro)'),
  prazo: z.string().max(60).optional().describe("prazo mencionado, em ISO (AAAA-MM-DD) se houver data explícita; vazio se não houver"),
});
const ExtractionSchema = z.object({
  resumo: z.string().describe("resumo em markdown com as seções: Resumo, Pontos principais, Decisões, Ações"),
  // .catch([]): modelos locais pequenos às vezes esquecem este campo ou mandam
  // formato levemente errado. Um resumo bom não deve ser jogado fora só porque
  // a extração de compromissos falhou — melhor entregar sem compromissos do
  // que entregar erro 502 e nada.
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

async function extractStructured(model: ReturnType<typeof resolveModel>, prompt: string): Promise<{ resumo: string; compromissos: Compromisso[] }> {
  return generateStructured(model, prompt, ExtractionSchema);
}

/** Resumo em passada única (transcrição cabe no orçamento configurado). */
async function summarizeSinglePass(model: ReturnType<typeof resolveModel>, transcript: string) {
  const { resumo, compromissos } = await extractStructured(model, SINGLE_PASS_PROMPT + transcript);
  return { summary: resumo.trim(), compromissos: dedupeCompromissos(compromissos) };
}

/** Resumo em mapa-redução (MTG.3): resume cada bloco, depois consolida. */
async function summarizeMapReduce(model: ReturnType<typeof resolveModel>, transcript: string, chunkChars: number) {
  const efetivo = Math.ceil(transcript.length / MAX_CHUNKS) > chunkChars ? Math.ceil(transcript.length / MAX_CHUNKS) : chunkChars;
  const blocos = chunkText(transcript, efetivo, Math.min(300, efetivo - 1));

  const parciais: { resumo: string; compromissos: Compromisso[] }[] = [];
  for (const bloco of blocos) {
    parciais.push(await extractStructured(model, CHUNK_PROMPT + bloco));
  }

  const combinado = parciais.map((p, i) => `### Trecho ${i + 1}\n${p.resumo}`).join("\n\n");
  const { text } = await generateText({ model, prompt: REDUCE_PROMPT + combinado });

  return { summary: text.trim(), compromissos: dedupeCompromissos(parciais.flatMap((p) => p.compromissos)), blocos: blocos.length };
}

/** Resume uma transcrição de reunião, extrai compromissos e a arquiva no RAG. */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const cfg = await settings.getMany(["limits.summaryMaxChars", "meetings.mapChunkChars"]);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error?.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const { transcript } = parsed.data;
  const title = parsed.data.title?.trim() || `Reunião ${new Date().toLocaleString("pt-BR")}`;
  const started = Date.now();
  const model = resolveModel(DEFAULT_MODEL_KEY);

  let summary: string;
  let compromissos: Compromisso[];
  let blocos = 1;
  try {
    if (transcript.length <= cfg["limits.summaryMaxChars"]) {
      ({ summary, compromissos } = await summarizeSinglePass(model, transcript));
    } else {
      const r = await summarizeMapReduce(model, transcript, cfg["meetings.mapChunkChars"]);
      summary = r.summary;
      compromissos = r.compromissos;
      blocos = r.blocos;
    }
  } catch (e) {
    log.error("meeting.summarize", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Falha ao resumir (LLM local disponível?)" }, { status: 502 });
  }

  // arquiva transcrição + resumo + compromissos no RAG (fica pesquisável e vira contexto do chat)
  const compromissosMd = compromissos.length
    ? "\n\n## Compromissos\n" + compromissos.map((c) => `- ${c.descricao}${c.responsavel ? ` (${c.responsavel})` : ""}${c.prazo ? ` (prazo ${c.prazo})` : ""}`).join("\n")
    : "";
  const doc = `# ${title}\n\n## Resumo\n${summary}${compromissosMd}\n\n## Transcrição\n${transcript}`;
  const res = await ingestDocument(session.user.id, title, doc, "meeting").catch(() => ({ chunks: 0, documentId: null as string | null }));

  log.info("meeting.summarize", { userId: session.user.id, ms: Date.now() - started, chars: transcript.length, blocos, compromissos: compromissos.length, chunks: res.chunks });
  return Response.json({ title, summary, compromissos, documentId: res.documentId, archived: res.chunks > 0, blocos });
}
