/**
 * TTS via serviço de leitura em voz alta do Microsoft Edge (voz da Órbita).
 *
 * Por que aqui e não no serviço Python: a fala não pode depender do Render, que
 * hiberna no plano free (~40 s para acordar). Rodando no Next, a latência é a
 * da rede e nada mais.
 *
 * ⚠️ Este endpoint não é uma API pública documentada — é o mesmo que o navegador
 * Edge usa. Não pede chave nem tem cota, mas pode mudar sem aviso. Se quebrar, a
 * saída é o Azure Speech (tier F0, 500k caracteres/mês grátis), que serve
 * exatamente as mesmas vozes: trocar de provedor não muda a voz da Órbita.
 *
 * Protocolo derivado da implementação de referência (pacote `edge-tts`).
 */

import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";

// ⚠️ NÃO é um segredo: é o token PÚBLICO fixo do serviço de leitura em voz alta
// do Microsoft Edge, idêntico em milhares de repositórios (biblioteca `edge-tts`
// e forks). Não dá acesso a nada da conta de ninguém. Está no allowlist do
// GitGuardian (.gitguardian.yaml) para não gerar falso positivo. ggignore
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"; // pragma: allowlist secret
const CHROMIUM_VERSION = "143.0.3650.75";
const BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const WIN_EPOCH = 11_644_473_600; // segundos entre 1601-01-01 e 1970-01-01

const DEFAULT_VOICE = "fr-FR-VivienneMultilingualNeural"; // escolhida em teste cego
const TIMEOUT_MS = 20_000;

export const EDGE_MIME = "audio/mpeg"; // o serviço devolve MP3, não WAV

/**
 * Correção de desvio de relógio, em segundos.
 *
 * O token abaixo é derivado do horário, então uma máquina com o relógio errado
 * leva 403 em todas as chamadas. Quando isso acontece, lemos o header `Date` da
 * resposta e passamos a compensar a diferença — mesma estratégia da
 * implementação de referência. Vale para o relógio do usuário e o do servidor.
 */
let desvioRelogio = 0;

export function ajustaDesvio(dataServidor: Date): void {
  desvioRelogio += (dataServidor.getTime() - Date.now()) / 1000;
}

/** Só para teste/diagnóstico. */
export function desvioAtual(): number {
  return desvioRelogio;
}

/**
 * Token anti-abuso exigido na URL: SHA-256 de (ticks + token), com os ticks em
 * formato Windows arredondados para baixo a cada 5 min.
 */
function secMsGec(): string {
  let ticks = Math.floor(Date.now() / 1000 + desvioRelogio) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7; // intervalos de 100 ns
  return createHash("sha256").update(`${ticks}${TRUSTED_CLIENT_TOKEN}`, "ascii").digest("hex").toUpperCase();
}

/** Data no formato que o serviço espera (estilo Date.toString() do JS). */
function dataEdge(): string {
  return new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
}

function escapaXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function edgeTtsAvailable(): boolean {
  return (process.env.TTS_PROVIDER ?? "auto") !== "piper";
}

/**
 * Sintetiza `text` e devolve um MP3. Lança se o serviço recusar ou expirar.
 *
 * O serviço faz streaming, mas juntamos tudo antes de responder porque a rota
 * devolve um blob; a latência baixa vem do serviço em si (~1 s até o 1º byte),
 * e o `splitFala` do cliente é quem começa a tocar cedo.
 */
export async function synthesizeEdge(text: string, signal?: AbortSignal): Promise<Buffer> {
  try {
    return await conecta(text, signal);
  } catch (e) {
    // 403 costuma ser relógio torto: o `conecta` já registrou o Date do servidor,
    // então uma segunda tentativa vai com o token corrigido.
    if (e instanceof Error && e.message === ERRO_DESVIO) return conecta(text, signal);
    throw e;
  }
}

const ERRO_DESVIO = "edge_tts_relogio_corrigido";

async function conecta(text: string, signal?: AbortSignal): Promise<Buffer> {
  // var própria: cada provedor tem seu catálogo, um nome não vale no outro
  const voz = process.env.TTS_EDGE_VOICE ?? DEFAULT_VOICE;
  const rate = process.env.TTS_EDGE_RATE ?? "+0%";
  const pitch = process.env.TTS_EDGE_PITCH ?? "+0Hz";

  const url =
    `wss://${BASE}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;

  const ws = new WebSocket(url, {
    headers: {
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      // exigido pelo serviço: sem isto a conexão é recusada antes do handshake
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)" +
        ` Chrome/${CHROMIUM_VERSION.split(".")[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_VERSION.split(".")[0]}.0.0.0`,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  return new Promise<Buffer>((resolve, reject) => {
    const partes: Buffer[] = [];
    let pronto = false;

    const encerra = (fn: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        /* já fechado */
      }
      fn();
    };
    const falha = (msg: string) => encerra(() => reject(new Error(msg)));
    const onAbort = () => falha("edge_tts_abortado");
    const timer = setTimeout(() => falha("edge_tts_timeout"), TIMEOUT_MS);

    if (signal?.aborted) return falha("edge_tts_abortado");
    signal?.addEventListener("abort", onAbort, { once: true });

    ws.on("open", () => {
      const ts = dataEdge();
      ws.send(
        `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false",` +
          `"wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`,
      );
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voz}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>` +
        `${escapaXml(text)}</prosody></voice></speak>`;
      // o Z extra no timestamp é bug do próprio Edge, mas o serviço espera assim
      ws.send(
        `X-RequestId:${randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`,
      );
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        if (/Path:turn\.end/.test(data.toString("utf8"))) {
          pronto = true;
          encerra(() =>
            partes.length ? resolve(Buffer.concat(partes)) : reject(new Error("edge_tts_sem_audio")),
          );
        }
        return;
      }
      // binário: 2 bytes big-endian com o tamanho do cabeçalho, depois o áudio
      if (data.length < 2) return;
      const headerLen = data.readUInt16BE(0);
      if (headerLen > data.length) return;
      if (!data.subarray(2, 2 + headerLen).toString("ascii").includes("Path:audio")) return;
      const audio = data.subarray(2 + headerLen);
      if (audio.length) partes.push(audio);
    });

    // handshake recusado (tipicamente 403 por token derivado de relógio errado):
    // aproveita o header Date da resposta para calibrar e sinaliza que vale repetir.
    let corrigiu = false;
    ws.on("unexpected-response", (_req, res) => {
      const date = res.headers?.date;
      if (res.statusCode === 403 && typeof date === "string") {
        const servidor = new Date(date);
        if (!Number.isNaN(servidor.getTime())) {
          ajustaDesvio(servidor);
          corrigiu = true;
          console.warn(`[tts] relogio fora de sincronia; corrigindo ${desvioAtual().toFixed(0)}s e repetindo`);
        }
      }
      falha(corrigiu ? ERRO_DESVIO : `edge_tts_http_${res.statusCode}`);
    });

    ws.on("error", (e: Error) => falha(corrigiu ? ERRO_DESVIO : `edge_tts_ws: ${e.message}`));
    ws.on("close", () => {
      if (!pronto) falha(corrigiu ? ERRO_DESVIO : "edge_tts_fechou_cedo");
    });
  });
}
