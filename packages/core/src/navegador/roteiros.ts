import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { navegadorRoteiro, type NavegadorRoteiro, type PassoDeRoteiro } from "@orbita/db/navegador-schema";
import { log } from "../observability/logger";

/**
 * ROTEIROS (PRD B4): a tarefa delegada que deu certo vira uma lista de passos
 * com alvo SEMÂNTICO (papel, nome e texto do elemento, com um seletor CSS de
 * reserva). Da próxima vez que o dono pedir a mesma coisa, a Órbita repete os
 * passos sem o modelo, e só chama o modelo no passo que não casar.
 *
 * O roteiro poupa modelo, não aprovação: cada passo reexecutado passa pelo
 * registro (sessão, crítico, risco pelo alvo, fila), exatamente como da
 * primeira vez. Um "Enviar" de roteiro continua indo para a fila.
 */

/** "Abrir o Jira e ver o que entrou!" e "abrir o jira e ver o que entrou" são a mesma intenção. Puro. */
export function chaveDaIntencao(objetivo: string): string {
  return objetivo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Só passos que dá para repetir com segurança: senha nunca chega aqui (a página recusa), e passo sem alvo nem URL é ruído. Puro. */
export function passosRepetiveis(passos: readonly PassoDeRoteiro[]): PassoDeRoteiro[] {
  return passos.filter((p) => (p.acao === "abrir" ? !!p.url : p.acao === "digitar" || p.acao === "tecla" || p.acao === "rolar" || !!(p.alvo && (p.alvo.nome || p.alvo.seletor || p.alvo.texto)))).slice(0, 60);
}

export async function buscarRoteiro(userId: string, objetivo: string): Promise<NavegadorRoteiro | null> {
  const chave = chaveDaIntencao(objetivo);
  if (!chave) return null;
  const [r] = await db
    .select()
    .from(navegadorRoteiro)
    .where(and(eq(navegadorRoteiro.userId, userId), eq(navegadorRoteiro.intencaoChave, chave)))
    // o que mais deu certo primeiro; um roteiro que só falha cai para o fim
    .orderBy(desc(sql`${navegadorRoteiro.usos} - 2 * ${navegadorRoteiro.falhas}`), desc(navegadorRoteiro.criadoEm))
    .limit(1);
  return r ?? null;
}

export async function salvarRoteiro(userId: string, r: { dominio: string; intencao: string; passos: PassoDeRoteiro[]; tokens: number }): Promise<NavegadorRoteiro | null> {
  const passos = passosRepetiveis(r.passos);
  const chave = chaveDaIntencao(r.intencao);
  if (!passos.length || !chave) return null;
  const [l] = await db
    .insert(navegadorRoteiro)
    .values({ userId, dominio: r.dominio.slice(0, 253) || "(vários)", intencao: r.intencao.slice(0, 500), intencaoChave: chave, passos, tokensAprendizado: r.tokens })
    .onConflictDoUpdate({
      target: [navegadorRoteiro.userId, navegadorRoteiro.dominio, navegadorRoteiro.intencaoChave],
      set: { passos, tokensAprendizado: r.tokens, falhas: 0 },
    })
    .returning();
  log.info("navegador.roteiro_salvo", { userId, roteiroId: l?.id, passos: passos.length });
  return l ?? null;
}

export async function marcarUsoDoRoteiro(userId: string, id: string, deuCerto: boolean): Promise<void> {
  await db
    .update(navegadorRoteiro)
    .set(deuCerto ? { usos: sql`${navegadorRoteiro.usos} + 1`, usadoEm: new Date() } : { falhas: sql`${navegadorRoteiro.falhas} + 1`, usadoEm: new Date() })
    .where(and(eq(navegadorRoteiro.id, id), eq(navegadorRoteiro.userId, userId)));
}

export async function listarRoteiros(userId: string): Promise<NavegadorRoteiro[]> {
  return db.select().from(navegadorRoteiro).where(eq(navegadorRoteiro.userId, userId)).orderBy(desc(navegadorRoteiro.criadoEm)).limit(200);
}

export async function removerRoteiro(userId: string, id: string): Promise<boolean> {
  const r = await db.delete(navegadorRoteiro).where(and(eq(navegadorRoteiro.id, id), eq(navegadorRoteiro.userId, userId))).returning({ id: navegadorRoteiro.id });
  return r.length > 0;
}
