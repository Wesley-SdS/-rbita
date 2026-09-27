import { describe, it, expect, vi, afterEach } from "vitest";
import { transcribeWithAssemblyAI } from "./assemblyai";

/**
 * O PEDIDO QUE SEPARA AS VOZES.
 *
 * O que este arquivo trava é a diferença entre dizer "acho que são 2" e "no
 * mínimo 2", porque ela decidiu o resultado numa reunião real:
 *
 *   `speakers_expected: 2`                   → dica, e o modelo ignorou
 *   `speaker_options.min_speakers_expected`  → piso, limite duro
 *
 * Com a dica, duas pessoas conversando na mesma sala (26/09/2026) voltaram numa
 * fala só, com a pergunta e a resposta grudadas: "Ô Lucas, você viu a página de
 * testes ontem? Eu vi sim."
 */

const arquivo = () => new File([new Uint8Array([1, 2, 3])], "reuniao", { type: "audio/webm" });

/** Sobe o `fetch`: upload → criação → uma consulta já concluída. */
function fetchFalso(aoCriar: (corpo: Record<string, unknown>) => { ok: boolean; status?: number; body?: string }) {
  const corpos: Record<string, unknown>[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/upload")) return new Response(JSON.stringify({ upload_url: "https://cdn/audio" }), { status: 200 });
    if (url.endsWith("/transcript") && init?.method === "POST") {
      const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
      corpos.push(corpo);
      const r = aoCriar(corpo);
      return r.ok
        ? new Response(JSON.stringify({ id: "t1" }), { status: 200 })
        : new Response(r.body ?? "erro", { status: r.status ?? 400 });
    }
    return new Response(
      JSON.stringify({ status: "completed", text: "bom dia", language_code: "pt", audio_duration: 12, utterances: [{ speaker: "A", text: "bom dia", start: 0, end: 900 }] }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", f);
  return corpos;
}

afterEach(() => vi.unstubAllGlobals());

describe("quantas vozes esperar", () => {
  it("manda PISO, não dica, quando o dono disse quantos são", async () => {
    const corpos = fetchFalso(() => ({ ok: true }));
    await transcribeWithAssemblyAI(arquivo(), "k", { diarize: true, expectedSpeakers: 2 });

    expect(corpos[0]!.speaker_labels).toBe(true);
    expect(corpos[0]!.speaker_options).toEqual({ min_speakers_expected: 2 });
    // a dica que o modelo ignora não é mais enviada
    expect(corpos[0]!.speakers_expected).toBeUndefined();
  });

  it("sem número informado, não inventa piso", async () => {
    const corpos = fetchFalso(() => ({ ok: true }));
    await transcribeWithAssemblyAI(arquivo(), "k", { diarize: true });

    expect(corpos[0]!.speaker_labels).toBe(true);
    expect(corpos[0]!.speaker_options).toBeUndefined();
  });

  it("sem diarização, nada de locutor no pedido", async () => {
    const corpos = fetchFalso(() => ({ ok: true }));
    await transcribeWithAssemblyAI(arquivo(), "k", { expectedSpeakers: 3 });

    expect(corpos[0]!.speaker_labels).toBeUndefined();
    expect(corpos[0]!.speaker_options).toBeUndefined();
  });

  it("conta sem `speaker_options` re-tenta SEM o piso, em vez de desistir", async () => {
    // separar sem piso ainda é muito melhor do que cair para o whisper local,
    // que não separa nada
    const corpos = fetchFalso((corpo) => (corpo.speaker_options ? { ok: false, status: 400, body: "unknown field speaker_options" } : { ok: true }));
    const r = await transcribeWithAssemblyAI(arquivo(), "k", { diarize: true, expectedSpeakers: 2 });

    expect(corpos).toHaveLength(2);
    expect(corpos[1]!.speaker_options).toBeUndefined();
    expect(corpos[1]!.speaker_labels).toBe(true);
    expect(r.text).toBe("bom dia");
  });

  it("erro que não é de piso continua sendo erro", async () => {
    fetchFalso(() => ({ ok: false, status: 401, body: "chave inválida" }));
    await expect(transcribeWithAssemblyAI(arquivo(), "k", { diarize: true, expectedSpeakers: 2 })).rejects.toThrow(/401/);
  });
});
