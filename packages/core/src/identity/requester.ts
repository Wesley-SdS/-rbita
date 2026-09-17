import { getOwnerId } from "../owner";
import { settings } from "../settings";
import { log } from "../observability/logger";
import type { Requester } from "../tools/registry";
import { getPerson, personForAccount } from "./people";
import { identifyVoice, type VoiceIdentification } from "./voice";

/**
 * QUEM PEDE (VZ.6/VZ.7). A conta logada é o ponto de partida; um trecho de voz
 * gravado junto do ditado pode dizer que é outra pessoa da casa. Só voz
 * RECONHECIDA com confiança troca quem pede; "provável" não (PRD §7).
 */

export type UnknownVoicePolicy = "conta" | "restrito";

/** Decisão pura: conta × voz × política. */
export function chooseRequester(conta: Requester, voz: { outcome: string; person: Requester | null } | null, policy: UnknownVoicePolicy, clipPresente = false): Requester {
  // trecho de voz presente mas a identificação FALHOU (percepção fora, timeout,
  // fala curta demais): no restrito isso também é voz não reconhecida
  if (!voz) return clipPresente && policy === "restrito" ? { personId: null, name: null, role: "visitante", via: "voz" } : conta;
  if (voz.outcome === "identificado" && voz.person) return voz.person;
  // voz presente mas não reconhecida: ou vale a conta, ou trata como visitante
  if (policy === "restrito") return { personId: null, name: null, role: "visitante", via: "voz" };
  return conta;
}

export interface VoiceClip {
  bytes: Uint8Array;
  mime: string;
}

/** "data:audio/webm;base64,..." → bytes + mime, respeitando o teto configurado. Puro sobre o limite. */
export function parseVoiceClip(dataUrl: string, maxKB: number): VoiceClip | null {
  const m = /^data:([\w/+.-]+)(?:;[\w=.-]+)*;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  // estima pelo base64 antes de decodificar (4 chars = 3 bytes)
  if ((m[2]!.length * 3) / 4 > maxKB * 1024 + 3) return null;
  const bytes = new Uint8Array(Buffer.from(m[2]!, "base64"));
  if (!bytes.length || bytes.length > maxKB * 1024) return null;
  return { bytes, mime: m[1]! };
}

/**
 * Monta o resolvedor preguiçoso do turno. Só vale para a conta DONA: pessoas e
 * biometria são da casa do dono; outra conta segue sem restrição de cômodo
 * própria (é o comportamento de antes). Falha de percepção degrada para a conta.
 */
export function requesterResolver(accountUserId: string, clip: VoiceClip | null): { resolve: () => Promise<Requester | null>; voice: () => Promise<VoiceIdentification | null> } {
  let voz: Promise<VoiceIdentification | null> | null = null;
  let quem: Promise<Requester | null> | null = null;

  const voice = () => {
    voz ??= (async () => {
      if (!clip) return null;
      const owner = await getOwnerId();
      if (owner !== accountUserId) return null;
      return identifyVoice(owner, clip.bytes, clip.mime, "comando");
    })().catch((e) => {
      // nunca uma rejeição solta: banco oscilando derrubaria o processo
      log.warn("identity.voz_falhou", { error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    return voz;
  };

  const resolve = () => {
    quem ??= (async () => {
      const owner = await getOwnerId();
      if (!owner || owner !== accountUserId) return null;
      const pessoa = await personForAccount(owner, accountUserId);
      const conta: Requester = pessoa
        ? { personId: pessoa.id, name: pessoa.name, role: pessoa.role, via: "conta" }
        : { personId: null, name: null, role: "dono", via: "conta" };
      const [v, policy] = await Promise.all([voice(), settings.get("identity.unknownVoicePolicy")]);
      if (!v) return chooseRequester(conta, null, policy, !!clip);
      const p = v.personId ? await getPerson(owner, v.personId) : null;
      const pessoaVoz: Requester | null = p ? { personId: p.id, name: p.name, role: p.role, via: "voz", confidence: v.score } : null;
      return chooseRequester(conta, { outcome: v.outcome, person: pessoaVoz }, policy);
    })();
    return quem;
  };

  return { resolve, voice };
}
