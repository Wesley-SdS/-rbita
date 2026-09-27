import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { modeloDeEmbedding } from "@orbita/llm";
import { db } from "@orbita/db";
import { chunk, memory, memoryCandidate } from "@orbita/db/knowledge-schema";
import { skill } from "@orbita/db/extension-schema";
import { haEntity } from "@orbita/db/home-schema";
import { log } from "../observability/logger";

/**
 * DE QUAL MODELO É CADA VETOR (E2 do PRD-SEM-OLLAMA).
 *
 * "Trocar o provedor invalida os vetores" era um aviso de tela que ninguém
 * obedecia: o banco ficava com dois espaços vetoriais misturados e a busca
 * piorava em silêncio. Agora cada vetor guarda o modelo (`embed_model`), a
 * busca só compara os do modelo ativo, e a tela do acervo diz quantos faltam.
 */

export interface ContagemPorModelo {
  /** nulo = vetor anterior à coluna, ainda sem rótulo */
  modelo: string | null;
  trechos: number;
  memorias: number;
}

export interface EstadoDosVetores {
  ativo: string | null;
  porModelo: ContagemPorModelo[];
  /** vetores que a busca ignora agora (modelo diferente do ativo) */
  faltamReindexar: number;
}

/** Puro: dos números por modelo, o que a tela precisa dizer. */
export function resumirVetores(linhas: ContagemPorModelo[], ativo: string | null): EstadoDosVetores {
  const porModelo = [...linhas].sort((a, b) => Number(b.modelo === ativo) - Number(a.modelo === ativo) || b.trechos + b.memorias - (a.trechos + a.memorias));
  const faltamReindexar = linhas.filter((l) => l.modelo !== ativo).reduce((n, l) => n + l.trechos + l.memorias, 0);
  return { ativo, porModelo, faltamReindexar };
}

/** Quantos trechos e memórias do dono existem por modelo de embedding. */
export async function estadoDosVetores(userId: string): Promise<EstadoDosVetores> {
  const ativo = await modeloDeEmbedding().catch(() => null);
  const linhas = await db.execute<{ modelo: string | null; trechos: number; memorias: number }>(sql`
    SELECT modelo, sum(trechos)::int AS trechos, sum(memorias)::int AS memorias FROM (
      SELECT embed_model AS modelo, count(*) AS trechos, 0 AS memorias FROM ${chunk} WHERE user_id = ${userId} GROUP BY 1
      UNION ALL
      SELECT embed_model, 0, count(*) FROM ${memory} WHERE user_id = ${userId} GROUP BY 1
    ) x GROUP BY modelo`);
  return resumirVetores(
    [...linhas].map((l) => ({ modelo: l.modelo, trechos: Number(l.trechos), memorias: Number(l.memorias) })),
    ativo,
  );
}

/**
 * Rotula, uma vez, os vetores gravados antes da coluna existir.
 *
 * Com o modelo ATIVO, e isto é deliberado: é exatamente com ele que a busca já
 * comparava esses vetores até hoje, então rotular assim não muda nada do que o
 * dono via. A alternativa (reembedar sozinho para "descobrir") mandaria
 * documentos para a nuvem sem pedido, inclusive os indexados quando o dono
 * tinha escolhido "local". Se ele sabe que parte veio de outro modelo, o
 * "Reindexar" resolve, e a partir daqui tudo nasce rotulado.
 */
export async function rotularVetoresLegados(): Promise<number> {
  const ativo = await modeloDeEmbedding().catch(() => null);
  if (!ativo) return 0; // config pede nuvem sem chave: não há modelo ativo para atribuir
  const feitos = await Promise.all([
    db.update(chunk).set({ embedModel: ativo }).where(isNull(chunk.embedModel)).returning({ id: chunk.id }),
    db.update(memory).set({ embedModel: ativo }).where(isNull(memory.embedModel)).returning({ id: memory.id }),
    db.update(memoryCandidate).set({ embedModel: ativo }).where(isNull(memoryCandidate.embedModel)).returning({ id: memoryCandidate.id }),
    // skill e entidade da casa podem não ter vetor ainda: essas ficam sem rótulo e ganham os dois juntos
    db.update(skill).set({ embedModel: ativo }).where(and(isNull(skill.embedModel), isNotNull(skill.embedding))).returning({ id: skill.id }),
    db.update(haEntity).set({ embedModel: ativo }).where(and(isNull(haEntity.embedModel), isNotNull(haEntity.embedding))).returning({ id: haEntity.id }),
  ]);
  const total = feitos.reduce((n, r) => n + r.length, 0);
  if (total) log.info("rag.vetores_legados_rotulados", { modelo: ativo, total });
  return total;
}
