import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@orbita/db";
import { person } from "@orbita/db/home-schema";
import { biometricConsent, identityAudit } from "@orbita/db/identity-schema";
import { biometricUnknownVoice, biometricVoiceEmbedding, biometricVoiceSample } from "@orbita/db/biometric-schema";
import { decryptSecret, encryptSecret } from "../crypto";
import { settings } from "../settings";
import { events } from "../events/index";
import { embedVoice, embedVoiceSegments } from "../perception/client";
import { IdentityError } from "./errors";
import { log } from "../observability/logger";
import { centroid, cosineSim, matchSignature, type MatchConfig, type MatchResult, type Signature, TENTATIVAS_ROTULO_UNICO } from "./match";
import { consentFor, type PersonLike } from "./rules";

/**
 * ASSINATURA DE VOZ (Onda 9). O vetor é calculado no apps/perception (local);
 * aqui mora quem é quem: consentimento, casamento, auditoria e persistência.
 *
 * Regra de ouro: só entra no casamento quem tem consentimento de VOZ vigente.
 * Revogou, a assinatura para de ser usada na hora, mesmo antes de apagada.
 */

export type VoiceSource = "cadastro" | "reuniao" | "correcao" | "comando";

async function matchConfig(): Promise<MatchConfig & { model: string }> {
  const c = await settings.getMany(["identity.voiceModel", "identity.voiceMatchThreshold", "identity.voiceProbableThreshold", "identity.voiceMargin", "identity.voiceMinSpeechSeconds"]);
  return {
    model: c["identity.voiceModel"],
    threshold: c["identity.voiceMatchThreshold"],
    probableThreshold: c["identity.voiceProbableThreshold"],
    margin: c["identity.voiceMargin"],
    minSpeechSeconds: c["identity.voiceMinSpeechSeconds"],
  };
}

type PersonRow = typeof person.$inferSelect;
const asLike = (p: PersonRow): PersonLike => ({ id: p.id, role: p.role, relation: p.relation, isMinor: p.isMinor, guardianPersonId: p.guardianPersonId });

/** Pessoas do dono com consentimento de voz vigente. */
async function consentedPeople(ownerUserId: string): Promise<PersonRow[]> {
  const people = await db.select().from(person).where(eq(person.userId, ownerUserId));
  if (!people.length) return [];
  const consents = await db.select().from(biometricConsent).where(inArray(biometricConsent.personId, people.map((p) => p.id)));
  return people.filter((p) => consentFor(asLike(p), consents, "voz").ok);
}

/** Assinaturas utilizáveis agora: só de quem consentiu, só do modelo configurado. */
export async function loadVoiceSignatures(ownerUserId: string, model: string): Promise<Signature[]> {
  const pessoas = await consentedPeople(ownerUserId);
  if (!pessoas.length) return [];
  const rows = await db
    .select({ personId: biometricVoiceEmbedding.personId, vector: biometricVoiceEmbedding.vector })
    .from(biometricVoiceEmbedding)
    .where(and(eq(biometricVoiceEmbedding.userId, ownerUserId), eq(biometricVoiceEmbedding.model, model), inArray(biometricVoiceEmbedding.personId, pessoas.map((p) => p.id))));
  const porPessoa = new Map<string, number[][]>();
  for (const r of rows) porPessoa.set(r.personId, [...(porPessoa.get(r.personId) ?? []), r.vector]);
  return [...porPessoa].map(([personId, vectors]) => ({ personId, vectors }));
}

async function requireVoiceConsent(ownerUserId: string, personId: string): Promise<PersonRow> {
  const [p] = await db.select().from(person).where(and(eq(person.id, personId), eq(person.userId, ownerUserId))).limit(1);
  if (!p) throw new IdentityError("Pessoa não encontrada", 404);
  const consents = await db.select().from(biometricConsent).where(eq(biometricConsent.personId, personId));
  const c = consentFor(asLike(p), consents, "voz");
  if (!c.ok) throw new IdentityError(`Sem consentimento de voz: ${c.motivo}`);
  return p;
}

/** Cadastro por gravação (VZ.3): consentimento, fala mínima, amostra cifrada e assinatura. */
export async function enrollVoice(ownerUserId: string, personId: string, audio: Uint8Array, mime: string, source: VoiceSource = "cadastro") {
  const p = await requireVoiceConsent(ownerUserId, personId);
  const [cfg, minFala] = await Promise.all([matchConfig(), settings.get("identity.voiceEnrollMinSeconds")]);
  const r = await embedVoice(audio, mime, cfg.model);
  if (source === "cadastro" && r.speechS < minFala) {
    throw new IdentityError(`Gravação com pouca fala (${r.speechS.toFixed(1)} s). Fale pelo menos ${minFala} s.`);
  }
  await db.transaction(async (tx) => {
    const [sample] = await tx
      .insert(biometricVoiceSample)
      .values({ userId: ownerUserId, personId: p.id, source, audioEnc: encryptSecret(Buffer.from(audio).toString("base64")), mime, durationS: r.durationS, speechS: r.speechS })
      .returning({ id: biometricVoiceSample.id });
    await tx.insert(biometricVoiceEmbedding).values({ userId: ownerUserId, personId: p.id, sampleId: sample!.id, model: r.model, dim: r.dim, vector: r.embedding });
    await tx.insert(identityAudit).values({ userId: ownerUserId, action: "cadastro_biometrico", personId: p.id, kind: "voz", source: "tela", outcome: "cadastrado", detail: { origem: source, falaS: r.speechS, modelo: r.model } });
  });
  await events.emit("identity.voice_enrolled", { personId: p.id, origem: source }, { userId: ownerUserId });
  return { personId: p.id, model: r.model, speechS: r.speechS, durationS: r.durationS };
}

export interface VoiceIdentification extends MatchResult {
  name: string | null;
  speechS: number;
  model: string;
}

/** "Quem pediu?" (VZ.6): identifica um trecho curto de comando e audita. */
export async function identifyVoice(ownerUserId: string, audio: Uint8Array, mime: string, source: "comando" | "tela" = "comando"): Promise<VoiceIdentification> {
  const [cfg, timeoutComando] = await Promise.all([matchConfig(), settings.get("identity.commandTimeoutMs")]);
  // comando tem prazo curto e próprio: uma reunião longa sendo processada não
  // pode segurar "acende a luz" pelo timeout de 60 s da percepção
  const [r, assinaturas] = await Promise.all([embedVoice(audio, mime, cfg.model, source === "comando" ? timeoutComando : undefined), loadVoiceSignatures(ownerUserId, cfg.model)]);
  const m = matchSignature(r.embedding, assinaturas, cfg, r.speechS);
  const nome = m.personId ? ((await db.select({ name: person.name }).from(person).where(eq(person.id, m.personId)).limit(1))[0]?.name ?? null) : null;
  await db.insert(identityAudit).values({
    userId: ownerUserId,
    action: "identificacao",
    personId: m.personId,
    kind: "voz",
    source,
    confidence: m.score,
    outcome: m.outcome,
    detail: { motivo: m.reason ?? null, falaS: r.speechS, modelo: r.model },
  });
  return { ...m, name: nome, speechS: r.speechS, model: r.model };
}

// ── reuniões ────────────────────────────────────────────────────────────────

export interface Utterance {
  speaker: string;
  startMs: number;
  endMs: number;
}

/** Falas mais longas de cada locutor até `maxSeconds`. Puro. */
export function pickSpeakerSegments(utterances: readonly Utterance[], maxSeconds: number): Map<string, { start: number; end: number }[]> {
  const porLocutor = new Map<string, Utterance[]>();
  for (const u of utterances) porLocutor.set(u.speaker, [...(porLocutor.get(u.speaker) ?? []), u]);
  const out = new Map<string, { start: number; end: number }[]>();
  for (const [speaker, us] of porLocutor) {
    let total = 0;
    const escolhidas: { start: number; end: number }[] = [];
    for (const u of [...us].sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))) {
      if (total >= maxSeconds) break;
      const dur = Math.min((u.endMs - u.startMs) / 1000, maxSeconds - total);
      if (dur <= 0) continue;
      // um monólogo de 25 min não vira um trecho de 25 min: corta no que falta do teto
      escolhidas.push({ start: u.startMs / 1000, end: u.startMs / 1000 + dur });
      total += dur;
    }
    if (escolhidas.length) out.set(speaker, escolhidas);
  }
  return out;
}

/**
 * Duas etiquetas da mesma reunião não podem ser a mesma pessoa (a diarização
 * separou as vozes). Fica com quem tem o maior escore; as outras voltam a ser
 * desconhecidas. Puro.
 */
export function resolveDuplicates<T extends { personId: string | null; score: number; outcome: string }>(porLocutor: Map<string, T>): Map<string, T> {
  const melhor = new Map<string, string>();
  for (const [label, r] of porLocutor) {
    if (!r.personId) continue;
    const atual = melhor.get(r.personId);
    if (!atual || porLocutor.get(atual)!.score < r.score) melhor.set(r.personId, label);
  }
  const out = new Map<string, T>();
  for (const [label, r] of porLocutor) {
    out.set(label, r.personId && melhor.get(r.personId) !== label ? { ...r, personId: null, outcome: "desconhecido" } : r);
  }
  return out;
}

/**
 * Vetor por locutor mantido em memória por pouco tempo (`identity.speakerRefTtlMinutes`),
 * só para "usar esta fala como amostra" logo depois de nomear. Some ao apagar ou
 * revogar a pessoa que casa com ele (`forgetVoiceTraces`).
 */
interface Ref {
  ownerUserId: string;
  model: string;
  vector: number[];
  speechS: number;
  expira: number;
  unknownId: string | null;
}
const refs = new Map<string, Ref>();

function guardarRef(r: Omit<Ref, "expira">, ttlMs: number): string {
  const agora = Date.now();
  for (const [k, v] of refs) if (v.expira < agora) refs.delete(k);
  const id = randomUUID();
  refs.set(id, { ...r, expira: agora + ttlMs });
  return id;
}

/** Próximo número de "Desconhecido N": maior já usado + 1 (expirado ou não, qualquer modelo). Puro. */
export function nextUnknownNumber(labels: readonly string[]): number {
  let max = 0;
  for (const l of labels) {
    const n = Number(/(\d+)$/.exec(l)?.[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export interface SpeakerIdentity {
  label: string;
  outcome: "identificado" | "provavel" | "desconhecido";
  personId: string | null;
  name: string | null;
  score: number;
  speechS: number;
  /** referência efêmera para cadastrar esta fala como amostra ao nomear */
  ref: string | null;
  /** "Desconhecido N" quando não reconhecido (reconhecível de novo por alguns dias) */
  unknownLabel: string | null;
}

/**
 * Nomes dos locutores de uma reunião (VZ.5). Diarização foi feita sobre o
 * áudio INTEIRO; aqui só se calcula uma assinatura por etiqueta e se compara
 * com quem consentiu. Não reconhecido vira desconhecido efêmero (decisão 9.2),
 * com validade FIXA a partir da primeira vez (reaparecer não renova o prazo).
 */
export async function identifyMeetingSpeakers(ownerUserId: string, audio: Uint8Array, mime: string, utterances: readonly Utterance[], sourceRef: string | null): Promise<SpeakerIdentity[]> {
  const cfg = await matchConfig();
  const extra = await settings.getMany(["identity.meetingSpeakerMaxSeconds", "identity.unknownRetentionDays", "identity.speakerRefTtlMinutes"]);
  const escolhidas = pickSpeakerSegments(utterances, extra["identity.meetingSpeakerMaxSeconds"]);
  if (!escolhidas.size) return [];

  const labels = [...escolhidas.keys()];
  const segmentos = labels.flatMap((l) => escolhidas.get(l)!.map((s) => ({ ...s, label: l })));
  const [r, assinaturas, todosDesconhecidos] = await Promise.all([
    embedVoiceSegments(audio, mime, cfg.model, segmentos.map(({ start, end }) => ({ start, end }))),
    loadVoiceSignatures(ownerUserId, cfg.model),
    db.select().from(biometricUnknownVoice).where(eq(biometricUnknownVoice.userId, ownerUserId)),
  ]);
  const agora = new Date();
  const desconhecidos = todosDesconhecidos.filter((d) => d.model === cfg.model && d.expiresAt > agora);

  const porLocutor = new Map<string, MatchResult & { vector: number[]; speechS: number }>();
  for (const label of labels) {
    const vs = r.segments.filter((_, i) => segmentos[i]!.label === label && r.segments[i]!.embedding);
    if (!vs.length) continue;
    const vector = centroid(vs.map((s) => s.embedding!));
    const speechS = vs.reduce((acc, s) => acc + s.speechS, 0);
    porLocutor.set(label, { ...matchSignature(vector, assinaturas, cfg, speechS), vector, speechS });
  }
  const resolvidos = resolveDuplicates(porLocutor);

  const nomes = new Map((await db.select({ id: person.id, name: person.name }).from(person).where(eq(person.userId, ownerUserId))).map((p) => [p.id, p.name]));
  const retencaoMs = extra["identity.unknownRetentionDays"] * 86_400_000;
  const refTtlMs = extra["identity.speakerRefTtlMinutes"] * 60_000;
  const rotulosUsados = todosDesconhecidos.map((d) => d.label);
  const desconhecidosDestaReuniao = new Set<string>();
  const out: SpeakerIdentity[] = [];

  for (const [label, m] of resolvidos) {
    let unknownLabel: string | null = null;
    let unknownId: string | null = null;
    if (m.outcome === "desconhecido") {
      // mesma voz desconhecida de outra reunião recente? reaproveita o rótulo,
      // mas nunca para duas etiquetas desta reunião (a diarização separou as vozes)
      const livres = desconhecidos.filter((d) => !desconhecidosDestaReuniao.has(d.id));
      const conhecido = matchSignature(m.vector, livres.map((d) => ({ personId: d.id, vectors: [d.vector] })), cfg, m.speechS);
      if (conhecido.outcome === "identificado" && conhecido.personId) {
        const d = livres.find((x) => x.id === conhecido.personId)!;
        unknownLabel = d.label;
        unknownId = d.id;
        await db.update(biometricUnknownVoice).set({ lastSeenAt: agora }).where(eq(biometricUnknownVoice.id, d.id));
      } else {
        // índice único (user_id, label): duas transcrições ao mesmo tempo não repetem o N
        for (let tentativa = 0; tentativa < TENTATIVAS_ROTULO_UNICO && !unknownId; tentativa++) {
          const rotulo = `Desconhecido ${nextUnknownNumber(rotulosUsados)}`;
          rotulosUsados.push(rotulo);
          const [row] = await db
            .insert(biometricUnknownVoice)
            .values({ userId: ownerUserId, label: rotulo, model: cfg.model, vector: m.vector, sourceRef, expiresAt: new Date(agora.getTime() + retencaoMs) })
            .onConflictDoNothing()
            .returning({ id: biometricUnknownVoice.id });
          if (row) {
            unknownId = row.id;
            unknownLabel = rotulo;
          }
        }
      }
      if (unknownId) desconhecidosDestaReuniao.add(unknownId);
    }
    out.push({
      label,
      outcome: m.outcome as SpeakerIdentity["outcome"],
      personId: m.personId,
      name: m.personId ? (nomes.get(m.personId) ?? null) : null,
      score: m.score,
      speechS: m.speechS,
      ref: guardarRef({ ownerUserId, model: cfg.model, vector: m.vector, speechS: m.speechS, unknownId }, refTtlMs),
      unknownLabel,
    });
    await db.insert(identityAudit).values({
      userId: ownerUserId,
      action: "identificacao",
      personId: m.personId,
      kind: "voz",
      source: "reuniao",
      confidence: m.score,
      outcome: m.outcome,
      detail: { locutor: label, falaS: m.speechS, reuniao: sourceRef, desconhecido: unknownLabel },
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Liga desconhecidos recém-criados à reunião de origem. Existe porque a ordem
 * do fluxo é transcrever primeiro, arquivar depois: quando a assinatura é
 * calculada, o documento da reunião ainda não existe. Sem isso o dono vê
 * "Desconhecido 2" sem nenhuma forma de voltar e dizer de quem é a voz.
 */
export async function linkUnknownVoicesToMeeting(ownerUserId: string, labels: readonly string[], documentId: string): Promise<number> {
  const limpos = labels.map((l) => l.trim()).filter(Boolean);
  if (!limpos.length) return 0;
  const r = await db
    .update(biometricUnknownVoice)
    .set({ sourceRef: documentId })
    .where(and(eq(biometricUnknownVoice.userId, ownerUserId), inArray(biometricUnknownVoice.label, limpos), isNull(biometricUnknownVoice.sourceRef)))
    .returning({ id: biometricUnknownVoice.id });
  return r.length;
}

/**
 * "Correção ensina" e cadastro a partir de reunião (VZ.4): ao nomear um locutor,
 * a fala dele vira amostra da pessoa, se houver consentimento. Sem o áudio da
 * reunião guardado, fica só o vetor (não recalculável se o modelo trocar). O
 * desconhecido de origem some: agora a voz tem dono e consentimento.
 */
export async function enrollFromMeetingRef(ownerUserId: string, personId: string, ref: string, source: "reuniao" | "correcao") {
  const r = refs.get(ref);
  if (!r || r.ownerUserId !== ownerUserId || r.expira < Date.now()) throw new IdentityError("A fala desta reunião já expirou. Grave uma amostra na tela de pessoas.", 404);
  const p = await requireVoiceConsent(ownerUserId, personId);
  await db.transaction(async (tx) => {
    const [sample] = await tx.insert(biometricVoiceSample).values({ userId: ownerUserId, personId: p.id, source, speechS: r.speechS }).returning({ id: biometricVoiceSample.id });
    await tx.insert(biometricVoiceEmbedding).values({ userId: ownerUserId, personId: p.id, sampleId: sample!.id, model: r.model, dim: r.vector.length, vector: r.vector });
    if (r.unknownId) await tx.delete(biometricUnknownVoice).where(and(eq(biometricUnknownVoice.id, r.unknownId), eq(biometricUnknownVoice.userId, ownerUserId)));
    await tx.insert(identityAudit).values({ userId: ownerUserId, action: "cadastro_biometrico", personId: p.id, kind: "voz", source, outcome: "cadastrado", detail: { origem: source, falaS: r.speechS } });
  });
  refs.delete(ref);
  return { personId: p.id };
}

/**
 * Rastro de voz de uma pessoa FORA das tabelas dela: desconhecidos guardados e
 * refs em memória que casam com a assinatura dela (ex.: a Anna foi "Desconhecido 1"
 * antes de ser nomeada). Chamado ao apagar a biometria, remover a pessoa ou
 * revogar o consentimento de voz: sem isto, a voz dela seguiria reconhecível
 * como desconhecida sem consentimento (PRD §4.5).
 */
export async function forgetVoiceTraces(ownerUserId: string, personId: string): Promise<{ desconhecidos: number; refs: number }> {
  const [vetores, probable] = await Promise.all([
    db.select({ model: biometricVoiceEmbedding.model, vector: biometricVoiceEmbedding.vector }).from(biometricVoiceEmbedding).where(and(eq(biometricVoiceEmbedding.userId, ownerUserId), eq(biometricVoiceEmbedding.personId, personId))),
    settings.get("identity.voiceProbableThreshold"),
  ]);
  if (!vetores.length) return { desconhecidos: 0, refs: 0 };
  const centroides = new Map<string, number[]>();
  for (const model of new Set(vetores.map((v) => v.model))) centroides.set(model, centroid(vetores.filter((v) => v.model === model).map((v) => v.vector)));
  const casa = (model: string, v: number[]) => {
    const c = centroides.get(model);
    return !!c && c.length === v.length && cosineSim(c, v) >= probable;
  };

  const desconhecidos = await db.select({ id: biometricUnknownVoice.id, model: biometricUnknownVoice.model, vector: biometricUnknownVoice.vector }).from(biometricUnknownVoice).where(eq(biometricUnknownVoice.userId, ownerUserId));
  const apagar = desconhecidos.filter((d) => casa(d.model, d.vector)).map((d) => d.id);
  if (apagar.length) await db.delete(biometricUnknownVoice).where(inArray(biometricUnknownVoice.id, apagar));

  let refsApagados = 0;
  for (const [k, r] of refs) {
    if (r.ownerUserId === ownerUserId && casa(r.model, r.vector)) {
      refs.delete(k);
      refsApagados++;
    }
  }
  return { desconhecidos: apagar.length, refs: refsApagados };
}

/** Quantas amostras e de que modelos cada pessoa tem (para a tela). */
export async function voiceEnrollmentSummary(ownerUserId: string) {
  const rows = await db
    .select({ personId: biometricVoiceEmbedding.personId, model: biometricVoiceEmbedding.model })
    .from(biometricVoiceEmbedding)
    .where(eq(biometricVoiceEmbedding.userId, ownerUserId));
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    out[r.personId] ??= {};
    out[r.personId]![r.model] = (out[r.personId]![r.model] ?? 0) + 1;
  }
  return out;
}

/** Retenção de desconhecido (9.2): chamado pelo scheduler. */
export async function purgeExpiredUnknownVoices(): Promise<number> {
  const r = await db.delete(biometricUnknownVoice).where(lt(biometricUnknownVoice.expiresAt, new Date())).returning({ id: biometricUnknownVoice.id });
  return r.length;
}

/**
 * Troca de modelo (PRD §6): recalcula a assinatura de toda amostra de CADASTRO
 * que ainda tem o áudio cifrado e não tem vetor do modelo atual. Amostras de
 * reunião (sem áudio guardado) não voltam: o dono regrava se quiser.
 */
export async function recomputeVoiceSignatures(ownerUserId: string): Promise<{ modelo: string; recalculadas: number; semAudio: number; falharam: number }> {
  const { model } = await matchConfig();
  // sem consentimento vigente não se gera vetor novo, nem de amostra antiga
  const consentidos = new Set((await consentedPeople(ownerUserId)).map((p) => p.id));
  const amostras = (await db.select().from(biometricVoiceSample).where(eq(biometricVoiceSample.userId, ownerUserId))).filter((a) => consentidos.has(a.personId));
  const jaTem = new Set(
    (await db.select({ sampleId: biometricVoiceEmbedding.sampleId }).from(biometricVoiceEmbedding).where(and(eq(biometricVoiceEmbedding.userId, ownerUserId), eq(biometricVoiceEmbedding.model, model)))).map((r) => r.sampleId),
  );
  let recalculadas = 0;
  let semAudio = 0;
  let falharam = 0;
  for (const a of amostras) {
    if (jaTem.has(a.id)) continue;
    if (!a.audioEnc) {
      semAudio++;
      continue;
    }
    // uma amostra corrompida (ou um timeout do serviço local no meio) não pode
    // jogar fora o recálculo das outras: conta e segue
    try {
      const bytes = Uint8Array.from(Buffer.from(decryptSecret(a.audioEnc), "base64"));
      const r = await embedVoice(bytes, a.mime ?? "audio/webm", model);
      await db.insert(biometricVoiceEmbedding).values({ userId: ownerUserId, personId: a.personId, sampleId: a.id, model: r.model, dim: r.dim, vector: r.embedding });
      recalculadas++;
    } catch (e) {
      falharam++;
      log.warn("identity.recalculo_voz_falhou", { sampleId: a.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { modelo: model, recalculadas, semAudio, falharam };
}
