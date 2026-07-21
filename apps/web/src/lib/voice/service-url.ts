import { log } from "@/lib/observability/logger";

/**
 * URL base do serviço de voz (apps/voice), validada.
 *
 * Existe porque um valor malformado em `VOICE_URL` (ex.: colar o rótulo junto,
 * `VOICE_URL = https://...`) fazia `new URL(base + "/stt")` estourar e derrubar
 * a rota com um erro opaco. Aqui a gente valida uma vez, corta espaços/quebras e
 * devolve só a origem limpa — ou `null` (com log claro) se estiver inutilizável.
 */
export function voiceServiceUrl(): string | null {
  const raw = process.env.VOICE_URL;
  if (raw === undefined) return "http://localhost:8001"; // default de dev

  const trimmed = raw.trim();
  try {
    // aceita "https://host/caminho" e mantém só protocolo+host (sem barra final)
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`;
  } catch {
    log.error("voice.url_invalida", {
      hint: "VOICE_URL deve ser só a URL (ex.: https://rbita.onrender.com), sem o rótulo/nome da variável",
      valorRecebido: trimmed.slice(0, 80),
    });
    return null;
  }
}
