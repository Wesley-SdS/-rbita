import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { haEntity, personRoomAccess } from "@orbita/db/home-schema";
import type { Requester } from "../tools/registry";
import { canAccessRoom } from "./permission";

/**
 * Mesma regra, para um CÔMODO direto (câmera, presença): olhar o quarto é tão
 * restrito quanto acender a luz dele. Devolve a recusa em pt-BR ou null.
 */
export async function authorizeRoomForRequester(roomId: string | null, requester: Requester | null, oQue: string): Promise<string | null> {
  if (!requester || requester.role === "dono") return null;
  const acessos = requester.personId
    ? await db.select({ roomId: personRoomAccess.roomId, allowed: personRoomAccess.allowed }).from(personRoomAccess).where(eq(personRoomAccess.personId, requester.personId))
    : [];
  if (canAccessRoom(requester.role, roomId, acessos)) return null;
  return `Quem pediu não tem permissão para ${oQue} neste cômodo.`;
}

/**
 * Aplica `permission.ts` (B7.1, que existia sem ninguém chamar) a uma ação de
 * casa, para QUEM PEDE. Sem quem pede identificado, ou sendo o dono, não
 * restringe: é o comportamento de antes. Devolve a recusa em pt-BR ou null.
 */
export async function authorizeEntityForRequester(userId: string, entityId: string, requester: Requester | null): Promise<string | null> {
  if (!requester || requester.role === "dono") return null;
  const [ent] = await db
    .select({ roomId: haEntity.roomId, nome: haEntity.friendlyName })
    .from(haEntity)
    .where(and(eq(haEntity.userId, userId), eq(haEntity.entityId, entityId)))
    .limit(1);
  const acessos = requester.personId
    ? await db.select({ roomId: personRoomAccess.roomId, allowed: personRoomAccess.allowed }).from(personRoomAccess).where(eq(personRoomAccess.personId, requester.personId))
    : [];
  // entidade que não está no índice (não sincronizada, id malformado) não tem
  // cômodo conhecido: para quem não é dono, isso é "não sei", e não sei nega
  if (!ent) return "Quem pediu não tem permissão para acionar esse dispositivo.";
  if (canAccessRoom(requester.role, ent.roomId, acessos)) return null;
  // o texto volta ao modelo (que pode ser de nuvem): sem o nome de quem pediu
  return `Quem pediu não tem permissão para acionar ${ent.nome} neste cômodo.`;
}
