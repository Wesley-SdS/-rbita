import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Criptografia simétrica AES-256-GCM para segredos em repouso (tokens OAuth dos
 * conectores). Requisito de LGPD do PRD: "criptografia em repouso".
 *
 * A chave de 32 bytes é derivada (scrypt) de CONNECTORS_ENC_KEY, ou, na ausência
 * dela, de BETTER_AUTH_SECRET — assim o desenvolvedor não precisa configurar mais
 * um segredo para começar, mas pode isolar a chave dos conectores em produção.
 */
let warnedFallback = false;
function encKey(): Buffer {
  const dedicated = process.env.CONNECTORS_ENC_KEY;
  const secret = dedicated ?? process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CONNECTORS_ENC_KEY (ou BETTER_AUTH_SECRET) ausente/curto — necessário para criptografar tokens dos conectores.",
    );
  }
  // Em produção, a chave dos conectores deve ser distinta do segredo de auth.
  if (!dedicated && process.env.NODE_ENV === "production" && !warnedFallback) {
    warnedFallback = true;
    console.warn(JSON.stringify({ level: "warn", msg: "CONNECTORS_ENC_KEY ausente — usando BETTER_AUTH_SECRET como fallback. Defina uma chave dedicada em produção." }));
  }
  // sal fixo derivado do nome do produto: a chave é determinística por segredo.
  return scryptSync(secret, "orbita.connectors.v1", 32);
}

const FORMAT = "v1";

/** Criptografa texto → string portável "v1:<iv>:<tag>:<ciphertext>" (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

/** Descriptografa uma string produzida por encryptSecret. Lança se adulterada. */
export function decryptSecret(payload: string): string {
  const [fmt, ivB64, tagB64, ctB64] = payload.split(":");
  if (fmt !== FORMAT || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Formato de segredo inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}
