import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { camera } from "@orbita/db/camera-schema";
import { provedoresDeVisaoEmOrdem, resolveVisionModel, type VisionCloudProvider } from "@orbita/llm";
import { registrarUso, FLUXO } from "../usage/registrar";
import { log } from "../observability/logger";
import { db } from "@orbita/db";
import { cameraEvent } from "@orbita/db/camera-schema";
import { settings } from "../settings";

/**
 * Narra UM keyframe (nunca vídeo contínuo — briefing §7.1). Sob demanda por
 * padrão (decisão do dono): só roda quando alguém pergunta "o que está
 * acontecendo" ou uma regra pede explicitamente, nunca a cada evento.
 */
/**
 * O recado de quando a privacidade da câmera força o modelo local.
 *
 * Sem isto a regra era INVISÍVEL: o dono ligava "identificar pessoas", a
 * leitura passava a levar um minuto na CPU e parecia que a câmera não tinha
 * funcionado. A regra continua valendo (decisão 9.6, imagem de câmera que
 * identifica gente nunca vai para a nuvem); o que muda é ela ser dita, com a
 * saída à mão.
 */
/**
 * A imagem desta câmera pode ir para a nuvem?
 *
 * DECISÃO DO DONO, 27/09/2026, revendo a decisão 9.6. Antes, câmera com
 * identificação de pessoas narrava SÓ com modelo local, sem exceção. Dois
 * fatos derrubaram isso:
 *
 *   1. MEDIDO: o `moondream` levou 43 s numa imagem real da webcam e devolveu
 *      "!!!". Não é lento, é inútil. A regra não protegia nada, só impedia de
 *      usar a câmera.
 *   2. NA NUVEM NÃO HÁ MODELO LOCAL. Com a Órbita no Render, "só local"
 *      significa "sem visão nenhuma" nessa câmera. A regra só funcionava na
 *      máquina de casa.
 *
 * O que NÃO mudou, e é outra regra: vetor de rosto e de voz continua indo
 * exclusivamente ao `apps/perception`, com o guard de saída barrando destino
 * que não seja local (§5.4.1). Identificar QUEM é segue em casa; o que passa a
 * poder ir para a nuvem é a DESCRIÇÃO DA CENA.
 *
 * Quem quiser o comportamento antigo liga `vision.identificacaoSoLocal`.
 */
export function decidirSoLocal(identificaPessoas: boolean, exigirLocal: boolean): boolean {
  return identificaPessoas && exigirLocal;
}

/** Igual ao `decidirSoLocal`, lendo a config do dono. */
export async function soLocalParaCamera(identificaPessoas: boolean): Promise<boolean> {
  if (!identificaPessoas) return false;
  return decidirSoLocal(true, await settings.get("vision.identificacaoSoLocal"));
}

export const AVISO_SO_LOCAL =
  "Esta câmera identifica pessoas, então só o modelo local pode olhar, e ele leva cerca de um minuto nesta máquina. Para respostas rápidas, desligue a identificação de pessoas nesta câmera, em Câmeras.";

export async function narrateSnapshot(snapshot: string, question = "O que está acontecendo nesta cena? Descreva em uma ou duas frases.", opts: { localOnly?: boolean; userId?: string } = {}): Promise<string> {
  const cfg = await settings.getMany(["vision.localModel", "vision.cloudModel", "vision.cloudProvider"]);

  // A ORDEM de quem pode ler a imagem. Era um provedor só, e isso bastou até
  // a conta de um deles esvaziar: em 22/09/2026 a chave da OpenAI ficou sem
  // crédito, a leitura tentou três vezes, levou 10 s e devolveu 500 — com a
  // chave do Gemini ao lado, configurada e funcionando, sem ser tentada.
  const nuvem = opts.localOnly
    ? []
    : provedoresDeVisaoEmOrdem(cfg["vision.cloudProvider"], {
        // a assinatura enxerga imagem e não custa nada a mais: quando o dono
        // escolheu assinatura, ela atende a visão como atende o chat
        assinatura: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
        openai: Boolean(process.env.OPENAI_API_KEY),
        gemini: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
        gateway: Boolean(process.env.AI_GATEWAY_API_KEY),
      });
  // o local fecha a fila sempre: sem nuvem nenhuma, ele é o que sobra
  const tentativas: (VisionCloudProvider | "local")[] = [...nuvem, "local"];

  const perguntaCompleta = `${question} Responda em português do Brasil.`;
  let ultimoErro: unknown = null;

  for (const alvo of tentativas) {
    const comecou = Date.now();
    try {
      const { text, usage } = await generateText({
        model: resolveVisionModel({
          localOnly: alvo === "local",
          local: cfg["vision.localModel"],
          cloud: cfg["vision.cloudModel"],
          cloudProvider: alvo === "local" ? "auto" : alvo,
        }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: perguntaCompleta },
              { type: "image", image: snapshot },
            ],
          },
        ],
      });
      if (opts.userId) {
        registrarUso({
          userId: opts.userId,
          fluxo: FLUXO.visao,
          referencia: alvo,
          servico: alvo === "local" ? "visao-local" : `visao-${alvo}`,
          consumo: { unidade: "tokens", entrada: usage?.inputTokens ?? 0, saida: usage?.outputTokens ?? 0 },
          duracaoMs: Date.now() - comecou,
        });
      }
      return text.trim();
    } catch (e) {
      ultimoErro = e;
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("visao.tentativa_falhou", { alvo, erro: msg.slice(0, 160) });
      if (opts.userId) {
        registrarUso({
          userId: opts.userId,
          fluxo: FLUXO.visao,
          referencia: alvo,
          servico: alvo === "local" ? "visao-local" : `visao-${alvo}`,
          consumo: { unidade: "tokens", entrada: 0, saida: 0 },
          duracaoMs: Date.now() - comecou,
          erro: msg.slice(0, 200),
        });
      }
      // erro cru do Ollama ("model not found") não diz ao dono o que fazer, e
      // com `localOnly` não existe plano B por decisão (nuvem está barrada aqui)
      if (opts.localOnly && /not found|no such model|404/i.test(msg)) {
        throw new Error(`O modelo de visão local "${cfg["vision.localModel"]}" não está instalado no Ollama, e esta câmera identifica pessoas, então a nuvem está barrada. Instale o modelo ou troque a chave "Modelo de visão local" em Ajustes.`);
      }
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error("Nenhum modelo de visão conseguiu ler a imagem.");
}

/** Narra e persiste na própria linha do evento (evita narrar o mesmo evento duas vezes). */
export async function narrateCameraEvent(eventId: string): Promise<string> {
  const [ev] = await db
    .select({ id: cameraEvent.id, snapshot: cameraEvent.snapshot, narration: cameraEvent.narration, identifica: camera.identifyFaces })
    .from(cameraEvent)
    .innerJoin(camera, eq(camera.id, cameraEvent.cameraId))
    .where(eq(cameraEvent.id, eventId))
    .limit(1);
  if (!ev) throw new Error("Evento de câmera não encontrado");
  if (ev.narration) return ev.narration;
  if (!ev.snapshot) throw new Error("Evento sem imagem para narrar");
  const narration = await narrateSnapshot(ev.snapshot, undefined, { localOnly: await soLocalParaCamera(ev.identifica) });
  await db.update(cameraEvent).set({ narration, narratedAt: new Date() }).where(eq(cameraEvent.id, eventId));
  return narration;
}
