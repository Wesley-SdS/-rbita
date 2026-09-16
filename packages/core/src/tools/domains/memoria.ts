import { z } from "zod";
import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { embedText } from "@orbita/llm";
import { db } from "@orbita/db";
import { memory } from "@orbita/db/knowledge-schema";
import { settings } from "../../settings";
import { retrieveContext } from "../../rag/retrieve";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: memória de longo prazo e conhecimento do usuário. */

export const salvar_memoria: ToolDef<z.ZodObject<{ fato: z.ZodString }>> = {
  name: "salvar_memoria",
  domain: "memoria",
  description: "Salva um fato ou preferência do usuário na memória de longo prazo.",
  risk: "escrita",
  keywords: ["lembrar", "memorizar", "anotar", "guardar", "preferência", "gosto"],
  inputSchema: z.object({ fato: z.string().describe("o fato a memorizar") }),
  run: async ({ fato }, { userId }) => {
    const [embedding, dedupSim] = await Promise.all([embedText(fato, "document"), settings.get("memory.dedupSim")]);
    // dedup: se já existe memória quase idêntica (sim > memory.dedupSim), não duplica.
    const sim = sql<number>`1 - (${cosineDistance(memory.embedding, embedding)})`;
    const [dup] = await db
      .select({ id: memory.id, sim })
      .from(memory)
      .where(and(eq(memory.userId, userId), gt(sim, dedupSim)))
      .orderBy(desc(sim))
      .limit(1);
    if (dup) return { salvo: false, motivo: "já memorizado", fato };
    await db.insert(memory).values({ userId, content: fato, embedding });
    return { salvo: true, fato };
  },
};

export const esquecer_memoria: ToolDef<z.ZodObject<{ descricao: z.ZodString }>> = {
  name: "esquecer_memoria",
  domain: "memoria",
  description: "Esquece (apaga) uma memória do usuário descrita em linguagem natural (ex: 'esqueça que gosto de café'). Busca a memória mais parecida e a remove.",
  risk: "escrita",
  keywords: ["esquecer", "apagar", "remover", "memória"],
  inputSchema: z.object({ descricao: z.string() }),
  run: async ({ descricao }, { userId }) => {
    const [q, minSim] = await Promise.all([embedText(descricao), settings.get("memory.forgetMinSim")]);
    const sim = sql<number>`1 - (${cosineDistance(memory.embedding, q)})`;
    const [hit] = await db
      .select({ id: memory.id, content: memory.content, sim })
      .from(memory)
      .where(and(eq(memory.userId, userId), gt(sim, minSim)))
      .orderBy(desc(sim))
      .limit(1);
    if (!hit) return { esquecido: false, motivo: "nenhuma memória parecida encontrada" };
    await db.delete(memory).where(and(eq(memory.id, hit.id), eq(memory.userId, userId)));
    return { esquecido: true, memoria: hit.content };
  },
};

export const buscar_conhecimento: ToolDef<z.ZodObject<{ consulta: z.ZodString }>> = {
  name: "buscar_conhecimento",
  domain: "memoria",
  description: "Busca nos documentos e na memória do usuário por informação relevante.",
  risk: "leitura",
  keywords: ["buscar", "documento", "arquivo", "memória", "conhecimento", "lembra", "falei", "combinamos"],
  inputSchema: z.object({ consulta: z.string() }),
  run: async ({ consulta }, { userId }) => {
    const hits = await retrieveContext(userId, consulta, await settings.get("rag.topK"));
    return { resultados: hits.map((h) => ({ fonte: h.source, trecho: h.content })) };
  },
};

registerTools([salvar_memoria, esquecer_memoria, buscar_conhecimento]);
