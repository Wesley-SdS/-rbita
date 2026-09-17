import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { user } from "@orbita/db/auth-schema";
import { instanceOwner } from "@orbita/db/owner-schema";
import { events } from "./events/index";
import { log } from "./observability/logger";

/**
 * DONO DA INSTÂNCIA (RV.1). Decide quem altera o que vale para a casa inteira:
 * ajustes globais, catálogo de tools, lista de e-mails autorizados e, a partir
 * da Onda 8, limiares e retenções biométricas. As demais contas da casa usam a
 * Órbita normalmente, mas não mudam essas regras.
 *
 * Decisão do dono (17/09): posse explícita e persistida, não deduzida a cada
 * leitura. Assim apagar a conta do dono nunca promove outra conta sozinha.
 */

export interface OwnerRow {
  userId: string | null;
}

export interface OwnerDecision {
  /** dono efetivo agora (null = instância órfã ou sem usuários) */
  ownerId: string | null;
  /** grava esta posse (primeira reivindicação ou recuperação pelo ambiente) */
  claim: string | null;
}

/**
 * Regra PURA da posse.
 *   - linha com dono vivo: é ele, e o ambiente não sobrescreve (não é um jeito
 *     de tomar a instância de quem já é dono)
 *   - sem linha (instância nova): o primeiro usuário reivindica
 *   - linha órfã (a conta do dono foi apagada): ninguém é promovido, exceto
 *     quem `ORBITA_OWNER_EMAIL` apontar, porque isso exige acesso à máquina
 */
export function decideOwner(row: OwnerRow | null, firstUserId: string | null, envOwnerUserId: string | null): OwnerDecision {
  if (row?.userId) return { ownerId: row.userId, claim: null };
  if (envOwnerUserId) return { ownerId: envOwnerUserId, claim: envOwnerUserId };
  if (!row && firstUserId) return { ownerId: firstUserId, claim: firstUserId };
  return { ownerId: null, claim: null };
}

// Cache curto: o guard roda em toda escrita de config, e a posse quase nunca muda.
const CACHE_MS = 5000;
let cache: { at: number; ownerId: string | null } | null = null;

async function userIdByEmail(email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email.trim().toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

/** Dono efetivo, reivindicando a posse na primeira chamada. */
export async function getOwnerId(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ownerId;
  const [row] = await db.select({ userId: instanceOwner.userId }).from(instanceOwner).where(eq(instanceOwner.id, 1)).limit(1);
  const [first] = row ? [] : await db.select({ id: user.id }).from(user).orderBy(asc(user.createdAt)).limit(1);
  const envEmail = process.env.ORBITA_OWNER_EMAIL?.trim();
  const envOwner = !row?.userId && envEmail ? await userIdByEmail(envEmail) : null;

  const d = decideOwner(row ?? null, first?.id ?? null, envOwner);
  if (!d.claim) {
    cache = { at: Date.now(), ownerId: d.ownerId };
    return d.ownerId;
  }
  // A reivindicação nunca sobrescreve um dono gravado por outra requisição no
  // meio do caminho (leitura velha + transferência concorrente): primeiro
  // usuário só insere se não houver linha; ambiente só preenche linha órfã.
  const q = db.insert(instanceOwner).values({ id: 1, userId: d.claim });
  if (envOwner) await q.onConflictDoUpdate({ target: instanceOwner.id, set: { userId: d.claim, updatedAt: new Date() }, where: isNull(instanceOwner.userId) });
  else await q.onConflictDoNothing();
  const [final] = await db.select({ userId: instanceOwner.userId }).from(instanceOwner).where(eq(instanceOwner.id, 1)).limit(1);
  const ownerId = final?.userId ?? null;
  if (ownerId === d.claim) log.info("owner.claimed", { userId: d.claim, via: envOwner ? "env" : "primeiro_usuario" });
  cache = { at: Date.now(), ownerId };
  return ownerId;
}

export async function isOwner(userId: string): Promise<boolean> {
  return (await getOwnerId()) === userId;
}

export class OwnerTransferError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404,
  ) {
    super(message);
    this.name = "OwnerTransferError";
  }
}

/** Só o dono atual transfere; o destino precisa já ter conta. */
export async function transferOwnership(fromUserId: string, toEmail: string): Promise<{ userId: string }> {
  if (!(await isOwner(fromUserId))) throw new OwnerTransferError("Somente o dono desta instância pode transferir a posse.", 403);
  const toId = await userIdByEmail(toEmail);
  if (!toId) throw new OwnerTransferError("Não existe conta com esse e-mail. A pessoa precisa entrar na Órbita uma vez antes.", 404);
  if (toId === fromUserId) throw new OwnerTransferError("Você já é o dono.", 400);
  await db.update(instanceOwner).set({ userId: toId, updatedAt: new Date() }).where(eq(instanceOwner.id, 1));
  cache = null;
  await events.emit("owner.transferred", { de: fromUserId, para: toId }, { userId: fromUserId });
  return { userId: toId };
}

/** Só para testes e para quem acabou de mudar a posse por fora. */
export function invalidateOwnerCache(): void {
  cache = null;
}
