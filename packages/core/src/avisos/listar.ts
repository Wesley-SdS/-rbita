import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@orbita/db";
import { notification, type Notification } from "@orbita/db/routine-schema";

/**
 * A leitura dos avisos: o sino (todos, com "só não lidos" e "carregar mais") e
 * a tela de Rotinas (só o que o dono pediu que fosse produzido).
 *
 * Antes era um `limit 30` fixo na rota: a tela de Rotinas mostrava "Reunião em
 * breve" e "Conector caiu" misturados com o resultado das rotinas, e aviso mais
 * velho que o trigésimo simplesmente sumia.
 */

export const ConsultaAvisos = z.object({
  /** `pedidos` = rotinas e regras do dono; `todos` = o sino */
  de: z.enum(["todos", "pedidos"]).catch("todos"),
  naoLidas: z.enum(["1", "0"]).optional().transform((v) => v === "1"),
  /** cursor: devolve os avisos criados ANTES deste instante */
  antes: z.string().datetime({ offset: true }).optional(),
  limite: z.coerce.number().int().min(1).max(100).catch(30),
});
export type ConsultaAvisos = z.infer<typeof ConsultaAvisos>;

/** Lê a consulta da URL. Campo torto cai no padrão, cursor torto é erro (400). */
export function lerConsulta(url: URL): { ok: true; consulta: ConsultaAvisos } | { ok: false; erro: string } {
  const r = ConsultaAvisos.safeParse(Object.fromEntries(url.searchParams));
  return r.success ? { ok: true, consulta: r.data } : { ok: false, erro: "Consulta inválida: 'antes' precisa ser uma data ISO." };
}

export const ORIGENS_PEDIDAS = ["rotina", "regra"] as const;

export async function listarAvisos(
  userId: string,
  c: ConsultaAvisos,
): Promise<{ notifications: Notification[]; unread: number; temMais: boolean }> {
  const base = [eq(notification.userId, userId)];
  if (c.de === "pedidos") base.push(inArray(notification.origem, [...ORIGENS_PEDIDAS]));
  const filtro = [...base];
  if (c.naoLidas) filtro.push(eq(notification.read, false));
  if (c.antes) filtro.push(lt(notification.createdAt, new Date(c.antes)));
  const [linhas, [naoLidas]] = await Promise.all([
    // um a mais só para saber se existe próxima página, sem contar a tabela
    db.select().from(notification).where(and(...filtro)).orderBy(desc(notification.createdAt)).limit(c.limite + 1),
    db.select({ n: count() }).from(notification).where(and(...base, eq(notification.read, false))),
  ]);
  return { notifications: linhas.slice(0, c.limite), unread: Number(naoLidas?.n ?? 0), temMais: linhas.length > c.limite };
}
