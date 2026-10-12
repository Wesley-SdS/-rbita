import { voiceServiceUrl } from "../../voice/service-url";
import { tamanhoLegivel } from "../texto";
import type { Progresso } from "../tipos";

/**
 * Áudio e vídeo anexados viram TEXTO pela transcrição que já existe
 * (`meetings/transcribe.ts`: AssemblyAI quando as reuniões permitem a nuvem,
 * senão o whisper local). Vídeo passa antes pelo serviço de voz, que separa o
 * áudio com o PyAV (a máquina não precisa de ffmpeg) e, se o dono quiser,
 * tira alguns quadros para o modelo de visão descrever.
 *
 * Nada aqui toca biometria: é transcrição de conteúdo, sem reconhecer quem
 * fala (a diarização e o reconhecimento de voz são só da reunião do dono).
 */

export interface MidiaLida {
  texto: string;
  resumo: string;
  avisos: string[];
  lido: boolean;
}

export interface DependenciasDaMidia {
  transcrever: (audio: Uint8Array, mime: string, referencia: string, progresso?: Progresso) => Promise<{ texto: string; provedor: string }>;
  descreverQuadro: (dataUrl: string) => Promise<string>;
}

async function dependenciasPadrao(userId: string): Promise<DependenciasDaMidia> {
  return {
    transcrever: async (audio, mime, referencia, progresso) => {
      const { transcribeRecording, textoDaTranscricao } = await import("../../meetings/transcribe");
      const r = await transcribeRecording(userId, audio, mime, { referencia }, progresso);
      return { texto: textoDaTranscricao(r), provedor: r.provider };
    },
    descreverQuadro: async (dataUrl) => {
      const { narrateSnapshot } = await import("../../cameras/narrate");
      return narrateSnapshot(dataUrl, "Descreva este quadro de um vídeo em uma ou duas frases, transcrevendo textos visíveis.", { userId });
    },
  };
}

/** O áudio do vídeo, em OGG/Opus, pelo serviço de voz. */
export async function audioDoVideo(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const base = voiceServiceUrl();
  if (!base) throw new Error("O serviço de voz não está configurado: sem ele não dá para separar o áudio do vídeo.");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "video");
  const res = await fetch(`${base}/extrair/audio`, { method: "POST", body: form, signal: AbortSignal.timeout(300_000) }).catch(() => null);
  if (!res) throw new Error("O serviço de voz não respondeu para separar o áudio do vídeo.");
  if (res.status === 422) throw new Error("O vídeo não tem trilha de áudio que eu consiga ler.");
  if (!res.ok) throw new Error(`O serviço de voz recusou o vídeo (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Alguns quadros do vídeo (JPEG), espalhados pela duração. */
export async function quadrosDoVideo(bytes: Uint8Array, mime: string, quantos: number): Promise<string[]> {
  const base = voiceServiceUrl();
  if (!base || quantos <= 0) return [];
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "video");
  const res = await fetch(`${base}/extrair/quadros?quantos=${quantos}`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) }).catch(() => null);
  if (!res?.ok) return [];
  const j = (await res.json().catch(() => null)) as { quadros?: string[] } | null;
  return (j?.quadros ?? []).filter((q) => typeof q === "string" && q.startsWith("data:image/")).slice(0, quantos);
}

export async function lerAudio(
  bytes: Uint8Array,
  mime: string,
  nome: string,
  opts: { userId?: string; transcrever: boolean; progresso?: Progresso; deps?: DependenciasDaMidia },
): Promise<MidiaLida> {
  const tamanho = tamanhoLegivel(bytes.length);
  if (!opts.transcrever) return { texto: "", lido: false, avisos: [], resumo: `Áudio de ${tamanho}. A transcrição de anexos está desligada em Ajustes.` };
  if (!opts.userId && !opts.deps) return { texto: "", lido: false, avisos: [], resumo: `Áudio de ${tamanho}, sem dono para a transcrição.` };
  const deps = opts.deps ?? (await dependenciasPadrao(opts.userId!));
  const r = await deps.transcrever(bytes, mime, `anexo "${nome}"`, opts.progresso);
  const texto = r.texto.trim();
  if (!texto) return { texto: "", lido: false, avisos: [], resumo: `Áudio de ${tamanho} sem fala que eu tenha entendido.` };
  return { texto, lido: true, avisos: [], resumo: `Áudio de ${tamanho}, transcrito (${texto.split(/\s+/).length} palavras).` };
}

export async function lerVideo(
  bytes: Uint8Array,
  mime: string,
  nome: string,
  opts: { userId?: string; transcrever: boolean; quadros: number; progresso?: Progresso; deps?: DependenciasDaMidia; extrairAudio?: typeof audioDoVideo; extrairQuadros?: typeof quadrosDoVideo },
): Promise<MidiaLida> {
  const tamanho = tamanhoLegivel(bytes.length);
  if (!opts.transcrever) return { texto: "", lido: false, avisos: [], resumo: `Vídeo de ${tamanho}. A transcrição de anexos está desligada em Ajustes.` };
  if (!opts.userId && !opts.deps) return { texto: "", lido: false, avisos: [], resumo: `Vídeo de ${tamanho}, sem dono para a transcrição.` };
  const deps = opts.deps ?? (await dependenciasPadrao(opts.userId!));
  const avisos: string[] = [];
  await opts.progresso?.(0, 2, "separando o áudio do vídeo");
  let fala = "";
  try {
    const ogg = await (opts.extrairAudio ?? audioDoVideo)(bytes, mime);
    fala = (await deps.transcrever(ogg, "audio/ogg", `vídeo "${nome}"`, opts.progresso)).texto.trim();
  } catch (e) {
    avisos.push(e instanceof Error ? e.message : String(e));
  }
  const descricoes: string[] = [];
  if (opts.quadros > 0) {
    await opts.progresso?.(1, 2, "olhando alguns quadros do vídeo");
    const quadros = await (opts.extrairQuadros ?? quadrosDoVideo)(bytes, mime, opts.quadros).catch(() => []);
    for (const [i, q] of quadros.entries()) {
      const d = await deps.descreverQuadro(q).catch(() => "");
      if (d.trim()) descricoes.push(`Quadro ${i + 1}: ${d.trim()}`);
    }
  }
  const texto = [fala ? `Fala transcrita:\n${fala}` : "", descricoes.length ? `O que aparece:\n${descricoes.join("\n")}` : ""].filter(Boolean).join("\n\n");
  if (!texto) return { texto: "", lido: false, avisos, resumo: `Vídeo de ${tamanho}: não consegui tirar fala nem imagem dele.` };
  return { texto, lido: true, avisos, resumo: `Vídeo de ${tamanho}${fala ? ", com a fala transcrita" : ""}${descricoes.length ? `, ${descricoes.length} quadro(s) descrito(s)` : ""}.` };
}
