import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { chunk, document } from "@orbita/db/knowledge-schema";

/**
 * "Quem disse que entregava na sexta?" (Onda 11). Busca a FALA entre reuniões
 * já transcritas, usando os nomes que o dono confirmou em `document.speakers`
 * (ou que a identificação de voz sugeriu na Onda 9).
 *
 * Sem embedding aqui de propósito: a pergunta é por um trecho literal dito por
 * alguém, e o texto da reunião já está no documento. O RAG continua sendo o
 * caminho para pergunta semântica ("o que ficou combinado sobre o contrato").
 */

export interface Fala {
  documentId: string;
  titulo: string;
  quando: Date;
  locutor: string;
  nome: string | null;
  trecho: string;
}

const RE_LINHA = /^\s*(?:\[?(?:locutor|speaker)\s*([A-Z0-9]{1,3})\]?|([A-Z0-9]{1,3}))\s*[:\-]\s*(.+)$/i;

/**
 * Quebra a transcrição em falas ("Locutor A: ..." ou "A: ..."), aplicando os
 * nomes confirmados. Puro: é o que o teste cobre.
 */
export function parseUtterances(texto: string, speakers: Record<string, string> | null): { locutor: string; nome: string | null; trecho: string }[] {
  const out: { locutor: string; nome: string | null; trecho: string }[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    const m = RE_LINHA.exec(linha.trim());
    if (!m) {
      // continuação da fala anterior
      const anterior = out[out.length - 1];
      if (anterior && linha.trim()) anterior.trecho += " " + linha.trim();
      continue;
    }
    const locutor = (m[1] ?? m[2] ?? "?").toUpperCase();
    out.push({ locutor, nome: speakers?.[locutor] ?? null, trecho: m[3]!.trim() });
  }
  return out;
}

/** Ordena por relevância simples: quantas palavras do pedido aparecem na fala. Puro. */
export function scoreFala(trecho: string, termos: readonly string[]): number {
  const t = trecho.toLowerCase();
  return termos.reduce((acc, termo) => acc + (termo.length > 2 && t.includes(termo) ? 1 : 0), 0);
}

export function termosDe(consulta: string): string[] {
  return consulta
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ç]+/i)
    .filter((w) => w.length > 2);
}

/**
 * Busca falas que contenham o assunto, opcionalmente de uma pessoa específica.
 * Devolve as mais relevantes, mais recentes primeiro em caso de empate.
 */
export async function quemDisse(ownerUserId: string, consulta: string, opts: { nome?: string | null; limite?: number } = {}): Promise<Fala[]> {
  const termos = termosDe(consulta);
  if (!termos.length) return [];
  // o texto da reunião mora nos `chunk` (o documento é só o cabeçalho): junta
  // os trechos na ordem para reconstruir as falas
  const linhas = await db
    .select({ id: document.id, title: document.title, speakers: document.speakers, createdAt: document.createdAt, content: chunk.content, idx: chunk.idx })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(and(eq(document.userId, ownerUserId), sql`${document.speakers} is not null`))
    .orderBy(desc(document.createdAt), chunk.idx)
    .limit(2000);

  const docs = new Map<string, { id: string; title: string; speakers: Record<string, string> | null; createdAt: Date; content: string }>();
  for (const l of linhas) {
    const atual = docs.get(l.id);
    if (atual) atual.content += "\n" + l.content;
    else docs.set(l.id, { id: l.id, title: l.title, speakers: l.speakers, createdAt: l.createdAt, content: l.content });
  }

  const achados: (Fala & { score: number })[] = [];
  for (const d of docs.values()) {
    if (!d.content) continue;
    for (const f of parseUtterances(d.content, d.speakers)) {
      if (opts.nome && (f.nome ?? "").toLowerCase() !== opts.nome.toLowerCase()) continue;
      const score = scoreFala(f.trecho, termos);
      if (!score) continue;
      achados.push({ documentId: d.id, titulo: d.title, quando: d.createdAt, locutor: f.locutor, nome: f.nome, trecho: f.trecho, score });
    }
  }
  return achados
    .sort((a, b) => b.score - a.score || b.quando.getTime() - a.quando.getTime())
    .slice(0, opts.limite ?? 5)
    .map(({ score: _s, ...f }) => f);
}
