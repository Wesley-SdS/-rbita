import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@orbita/db";
import { person } from "@orbita/db/home-schema";
import { camera, cameraEvent } from "@orbita/db/camera-schema";
import { biometricConsent, identityAudit } from "@orbita/db/identity-schema";
import { biometricFaceEmbedding, biometricFaceSample, biometricUnknownFace } from "@orbita/db/biometric-schema";
import { encryptSecret } from "../crypto";
import { settings } from "../settings";
import { events } from "../events/index";
import { embedFaces, type FaceResult } from "../perception/client";
import { IdentityError } from "./errors";
import { centroid, cosineSim, matchSignature, type MatchConfig, type MatchResult, type Signature, TENTATIVAS_ROTULO_UNICO } from "./match";
import { nextUnknownNumber } from "./voice";
import { consentFor, type PersonLike } from "./rules";
import { updatePresence } from "./presence";
import { log } from "../observability/logger";

/**
 * ROSTO (Onda 10). Mesma disciplina da voz: o vetor vem do serviço LOCAL, só
 * entra no casamento quem tem consentimento de ROSTO vigente, toda
 * identificação é auditada, e rosto desconhecido vira identidade efêmera com
 * prazo fixo (decisão 9.2).
 *
 * Recorte de rosto de câmera NÃO é guardado: fica o vetor e o snapshot que o
 * evento já tinha. Só a foto de CADASTRO é guardada (cifrada) para recalcular.
 */

async function faceConfig(): Promise<MatchConfig & { backend: string; minSize: number }> {
  const c = await settings.getMany([
    "identity.faceBackend",
    "identity.faceMatchThreshold",
    "identity.faceProbableThreshold",
    "identity.faceMargin",
    "identity.faceMinSizePx",
  ]);
  return {
    backend: c["identity.faceBackend"],
    threshold: c["identity.faceMatchThreshold"],
    probableThreshold: c["identity.faceProbableThreshold"],
    margin: c["identity.faceMargin"],
    minSize: c["identity.faceMinSizePx"],
  };
}

type PersonRow = typeof person.$inferSelect;
const asLike = (p: PersonRow): PersonLike => ({ id: p.id, role: p.role, relation: p.relation, isMinor: p.isMinor, guardianPersonId: p.guardianPersonId });

async function consentedPeople(ownerUserId: string): Promise<PersonRow[]> {
  const people = await db.select().from(person).where(eq(person.userId, ownerUserId));
  if (!people.length) return [];
  const consents = await db.select().from(biometricConsent).where(inArray(biometricConsent.personId, people.map((p) => p.id)));
  return people.filter((p) => consentFor(asLike(p), consents, "rosto").ok);
}

export async function loadFaceSignatures(ownerUserId: string, backend: string): Promise<Signature[]> {
  const pessoas = await consentedPeople(ownerUserId);
  if (!pessoas.length) return [];
  const rows = await db
    .select({ personId: biometricFaceEmbedding.personId, vector: biometricFaceEmbedding.vector })
    .from(biometricFaceEmbedding)
    .where(and(eq(biometricFaceEmbedding.userId, ownerUserId), eq(biometricFaceEmbedding.backend, backend), inArray(biometricFaceEmbedding.personId, pessoas.map((p) => p.id))));
  const porPessoa = new Map<string, number[][]>();
  for (const r of rows) porPessoa.set(r.personId, [...(porPessoa.get(r.personId) ?? []), r.vector]);
  return [...porPessoa].map(([personId, vectors]) => ({ personId, vectors }));
}

async function requireFaceConsent(ownerUserId: string, personId: string): Promise<PersonRow> {
  const [p] = await db.select().from(person).where(and(eq(person.id, personId), eq(person.userId, ownerUserId))).limit(1);
  if (!p) throw new IdentityError("Pessoa não encontrada", 404);
  const consents = await db.select().from(biometricConsent).where(eq(biometricConsent.personId, personId));
  const c = consentFor(asLike(p), consents, "rosto");
  if (!c.ok) throw new IdentityError(`Sem consentimento de rosto: ${c.motivo}`);
  return p;
}

/** O maior rosto da imagem, se houver algum grande o bastante para valer. */
export function mainFace(faces: readonly FaceResult[], minSize: number): FaceResult | null {
  const grandes = [...faces].filter((f) => f.size >= minSize).sort((a, b) => b.size - a.size);
  return grandes[0] ?? null;
}

/** Cadastro por foto (RS.2): uma foto, um rosto claro, com consentimento. */
export async function enrollFace(ownerUserId: string, personId: string, image: Uint8Array, mime: string, source: "cadastro" | "camera" | "correcao" = "cadastro") {
  const p = await requireFaceConsent(ownerUserId, personId);
  const cfg = await faceConfig();
  const r = await embedFaces(image, mime, cfg.backend);
  if (!r.faces.length) throw new IdentityError("Nenhum rosto encontrado na foto.");
  if (r.faces.length > 1) throw new IdentityError("Mais de um rosto na foto. Use uma foto só com a pessoa.");
  const rosto = mainFace(r.faces, cfg.minSize);
  if (!rosto) throw new IdentityError(`Rosto pequeno demais na foto (mínimo ${cfg.minSize} px). Aproxime ou use uma foto maior.`);

  await db.transaction(async (tx) => {
    const [sample] = await tx
      .insert(biometricFaceSample)
      .values({ userId: ownerUserId, personId: p.id, source, imageEnc: encryptSecret(Buffer.from(image).toString("base64")), mime, faceSize: rosto.size })
      .returning({ id: biometricFaceSample.id });
    await tx.insert(biometricFaceEmbedding).values({ userId: ownerUserId, personId: p.id, sampleId: sample!.id, backend: r.backend, dim: rosto.embedding.length, vector: rosto.embedding });
    await tx.insert(identityAudit).values({ userId: ownerUserId, action: "cadastro_biometrico", personId: p.id, kind: "rosto", source: "tela", outcome: "cadastrado", detail: { origem: source, tamanho: rosto.size, backend: r.backend } });
  });
  await events.emit("identity.face_enrolled", { personId: p.id, origem: source }, { userId: ownerUserId });
  return { personId: p.id, backend: r.backend, faceSize: rosto.size };
}

export interface FaceIdentification extends MatchResult {
  name: string | null;
  faceSize: number;
  backend: string;
  unknownLabel: string | null;
}

/**
 * Identifica o rosto principal de uma imagem. `guardarDesconhecido` só na
 * câmera: o teste manual na tela não cria identidade efêmera à toa.
 */
export async function identifyFace(
  ownerUserId: string,
  image: Uint8Array,
  mime: string,
  opts: { source: string; sourceRef?: string | null; guardarDesconhecido?: boolean },
): Promise<FaceIdentification | null> {
  const cfg = await faceConfig();
  const [r, assinaturas] = await Promise.all([embedFaces(image, mime, cfg.backend), loadFaceSignatures(ownerUserId, cfg.backend)]);
  const rosto = mainFace(r.faces, cfg.minSize);
  if (!rosto) return null;

  const m = matchSignature(rosto.embedding, assinaturas, cfg);
  let unknownLabel: string | null = null;
  if (m.outcome === "desconhecido" && opts.guardarDesconhecido && !(await ehDeQuemRevogou(ownerUserId, cfg, rosto.embedding))) {
    unknownLabel = await lembrarDesconhecido(ownerUserId, cfg, rosto.embedding, opts.sourceRef ?? null);
  }

  const nome = m.personId ? ((await db.select({ name: person.name }).from(person).where(eq(person.id, m.personId)).limit(1))[0]?.name ?? null) : null;
  await db.insert(identityAudit).values({
    userId: ownerUserId,
    action: "identificacao",
    personId: m.personId,
    kind: "rosto",
    source: opts.source,
    confidence: m.score,
    outcome: m.outcome,
    detail: { tamanho: rosto.size, backend: r.backend, desconhecido: unknownLabel, ref: opts.sourceRef ?? null },
  });
  return { ...m, name: nome, faceSize: rosto.size, backend: r.backend, unknownLabel };
}

/**
 * O rosto é de alguém que REVOGOU o consentimento? Nesse caso ele não entra no
 * casamento (loadFaceSignatures já o exclui), mas também não pode virar
 * "Desconhecido N": seria rastrear anonimamente exatamente quem pediu para sair.
 * A assinatura guardada só é usada aqui, para reconhecer e ignorar.
 */
async function ehDeQuemRevogou(ownerUserId: string, cfg: MatchConfig & { backend: string }, vector: number[]): Promise<boolean> {
  const consentidos = new Set((await consentedPeople(ownerUserId)).map((p) => p.id));
  const rows = await db
    .select({ personId: biometricFaceEmbedding.personId, vector: biometricFaceEmbedding.vector })
    .from(biometricFaceEmbedding)
    .where(and(eq(biometricFaceEmbedding.userId, ownerUserId), eq(biometricFaceEmbedding.backend, cfg.backend)));
  const porPessoa = new Map<string, number[][]>();
  for (const r of rows) if (!consentidos.has(r.personId)) porPessoa.set(r.personId, [...(porPessoa.get(r.personId) ?? []), r.vector]);
  if (!porPessoa.size) return false;
  const m = matchSignature(vector, [...porPessoa].map(([personId, vectors]) => ({ personId, vectors })), cfg);
  return m.outcome !== "desconhecido";
}

/** Rosto desconhecido: reaproveita o rótulo de um recente, senão cria um novo com prazo FIXO. */
async function lembrarDesconhecido(ownerUserId: string, cfg: MatchConfig & { backend: string }, vector: number[], sourceRef: string | null): Promise<string | null> {
  const [todos, dias] = await Promise.all([
    db.select().from(biometricUnknownFace).where(eq(biometricUnknownFace.userId, ownerUserId)),
    settings.get("identity.unknownRetentionDays"),
  ]);
  const agora = new Date();
  const vivos = todos.filter((d) => d.backend === cfg.backend && d.expiresAt > agora);
  const conhecido = matchSignature(vector, vivos.map((d) => ({ personId: d.id, vectors: [d.vector] })), cfg);
  if (conhecido.outcome === "identificado" && conhecido.personId) {
    const d = vivos.find((x) => x.id === conhecido.personId)!;
    await db.update(biometricUnknownFace).set({ lastSeenAt: agora }).where(eq(biometricUnknownFace.id, d.id));
    return d.label;
  }
  const rotulos = todos.map((d) => d.label);
  for (let tentativa = 0; tentativa < TENTATIVAS_ROTULO_UNICO; tentativa++) {
    const rotulo = `Desconhecido ${nextUnknownNumber(rotulos)}`;
    rotulos.push(rotulo);
    const [row] = await db
      .insert(biometricUnknownFace)
      .values({ userId: ownerUserId, label: rotulo, backend: cfg.backend, vector, sourceRef, expiresAt: new Date(agora.getTime() + dias * 86_400_000) })
      .onConflictDoNothing()
      .returning({ id: biometricUnknownFace.id });
    if (row) return rotulo;
  }
  return null;
}

/**
 * Identifica quem apareceu num evento de câmera e atualiza a presença (RS.3 e
 * RS.4). Chamado em segundo plano pela ingestão: o webhook do Frigate não
 * espera por isto. Só roda se a câmera tiver identificação ligada.
 */
export async function identifyCameraEvent(eventId: string): Promise<FaceIdentification | null> {
  const [ev] = await db
    .select({ id: cameraEvent.id, userId: cameraEvent.userId, snapshot: cameraEvent.snapshot, cameraId: cameraEvent.cameraId, roomId: camera.roomId, identifica: camera.identifyFaces })
    .from(cameraEvent)
    .innerJoin(camera, eq(camera.id, cameraEvent.cameraId))
    .where(eq(cameraEvent.id, eventId))
    .limit(1);
  if (!ev || !ev.identifica || !ev.snapshot) return null;

  const sep = ev.snapshot.indexOf(",");
  const mime = /^data:([^;,]+)/.exec(ev.snapshot)?.[1] ?? "image/jpeg";
  const bytes = new Uint8Array(Buffer.from(ev.snapshot.slice(sep + 1), "base64"));

  const r = await identifyFace(ev.userId, bytes, mime, { source: "camera", sourceRef: ev.id, guardarDesconhecido: true });
  if (!r) return null;

  await db
    .update(cameraEvent)
    .set({ identifiedPersonId: r.personId, identifiedScore: r.score, identifiedOutcome: r.outcome, identifiedLabel: r.unknownLabel, identifiedAt: new Date() })
    .where(eq(cameraEvent.id, ev.id));

  // presença só com identificação afirmada: "provavelmente" não move ninguém de cômodo
  if (r.outcome === "identificado" && r.personId) {
    await updatePresence(ev.userId, r.personId, ev.roomId, "camera", r.score);
  }
  await events.emit("identity.seen", { personId: r.personId, nome: r.name, outcome: r.outcome, roomId: ev.roomId, cameraId: ev.cameraId, desconhecido: r.unknownLabel }, { userId: ev.userId }).catch(() => undefined);
  return r;
}

/** Igual ao da voz: o rastro de rosto dela fora das tabelas dela também some. */
export async function forgetFaceTraces(ownerUserId: string, personId: string): Promise<{ desconhecidos: number }> {
  const [vetores, probable] = await Promise.all([
    db.select({ backend: biometricFaceEmbedding.backend, vector: biometricFaceEmbedding.vector }).from(biometricFaceEmbedding).where(and(eq(biometricFaceEmbedding.userId, ownerUserId), eq(biometricFaceEmbedding.personId, personId))),
    settings.get("identity.faceProbableThreshold"),
  ]);
  if (!vetores.length) return { desconhecidos: 0 };
  const centroides = new Map<string, number[]>();
  for (const b of new Set(vetores.map((v) => v.backend))) centroides.set(b, centroid(vetores.filter((v) => v.backend === b).map((v) => v.vector)));
  const desconhecidos = await db.select({ id: biometricUnknownFace.id, backend: biometricUnknownFace.backend, vector: biometricUnknownFace.vector }).from(biometricUnknownFace).where(eq(biometricUnknownFace.userId, ownerUserId));
  const apagar = desconhecidos
    .filter((d) => {
      const c = centroides.get(d.backend);
      return !!c && c.length === d.vector.length && cosineSim(c, d.vector) >= probable;
    })
    .map((d) => d.id);
  if (apagar.length) await db.delete(biometricUnknownFace).where(inArray(biometricUnknownFace.id, apagar));
  return { desconhecidos: apagar.length };
}

/** Retenção do rosto desconhecido (9.2), chamada pelo scheduler junto com a da voz. */
export async function purgeExpiredUnknownFaces(): Promise<number> {
  const r = await db.delete(biometricUnknownFace).where(lt(biometricUnknownFace.expiresAt, new Date())).returning({ id: biometricUnknownFace.id });
  return r.length;
}

/** Quantas fotos cada pessoa tem, por backend (para a tela). */
export async function faceEnrollmentSummary(ownerUserId: string) {
  const rows = await db.select({ personId: biometricFaceEmbedding.personId, backend: biometricFaceEmbedding.backend }).from(biometricFaceEmbedding).where(eq(biometricFaceEmbedding.userId, ownerUserId));
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    out[r.personId] ??= {};
    out[r.personId]![r.backend] = (out[r.personId]![r.backend] ?? 0) + 1;
  }
  return out;
}

/** Recalcula assinaturas de rosto depois de trocar o backend (só de quem consentiu). */
export type RecomputeProgress = (feito: number, total: number, passo: string) => Promise<void>;

/**
 * O `progresso` é também o sinal de vida do trabalho na fila: sem ele, recalcular
 * dezenas de fotos seria confundido com trabalho travado.
 */
export async function recomputeFaceSignatures(ownerUserId: string, progresso?: RecomputeProgress): Promise<{ backend: string; recalculadas: number; semFoto: number; semRosto: number; falharam: number }> {
  const cfg = await faceConfig();
  const consentidos = new Set((await consentedPeople(ownerUserId)).map((p) => p.id));
  const amostras = (await db.select().from(biometricFaceSample).where(eq(biometricFaceSample.userId, ownerUserId))).filter((a) => consentidos.has(a.personId));
  const jaTem = new Set(
    (await db.select({ sampleId: biometricFaceEmbedding.sampleId }).from(biometricFaceEmbedding).where(and(eq(biometricFaceEmbedding.userId, ownerUserId), eq(biometricFaceEmbedding.backend, cfg.backend)))).map((r) => r.sampleId),
  );
  let recalculadas = 0;
  let semFoto = 0;
  // foto em que o modelo novo não achou rosto: antes sumia sem contar, e o dono
  // não sabia que aquela pessoa tinha ficado com menos amostras
  let semRosto = 0;
  let falharam = 0;
  const pendentes = amostras.filter((a) => !jaTem.has(a.id));
  for (const [i, a] of pendentes.entries()) {
    await progresso?.(i, pendentes.length, `recalculando a foto ${i + 1} de ${pendentes.length}`);
    if (!a.imageEnc) {
      semFoto++;
      continue;
    }
    try {
      const { decryptSecret } = await import("../crypto");
      const bytes = new Uint8Array(Buffer.from(decryptSecret(a.imageEnc), "base64"));
      const r = await embedFaces(bytes, a.mime ?? "image/jpeg", cfg.backend);
      const rosto = mainFace(r.faces, cfg.minSize);
      if (!rosto) {
        semRosto++;
        continue;
      }
      await db.insert(biometricFaceEmbedding).values({ userId: ownerUserId, personId: a.personId, sampleId: a.id, backend: r.backend, dim: rosto.embedding.length, vector: rosto.embedding });
      recalculadas++;
    } catch (e) {
      falharam++;
      log.warn("identity.recalculo_rosto_falhou", { sampleId: a.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await progresso?.(pendentes.length, pendentes.length, "pronto");
  return { backend: cfg.backend, recalculadas, semFoto, semRosto, falharam };
}
