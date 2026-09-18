import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Transcrição de uma gravação inteira, usada pelo `/api/stt` (imediato) e pela
 * fila de reunião. O que importa: quem é quem só roda para o dono e só com
 * diarização, e percepção fora do ar não derruba a transcrição.
 */

let resultado: Record<string, unknown> = {};
let dono = "dono";
let identidades: unknown = [{ label: "A", outcome: "identificado", personId: "p1", name: "Anna", score: 0.9, unknownLabel: null }];
const identificacoes: unknown[] = [];

vi.mock("../stt/index", () => ({ transcribeAudio: async () => resultado }));
vi.mock("../owner", () => ({ getOwnerId: async () => dono }));
vi.mock("../identity/actions", () => ({
  identificarLocutoresDaReuniao: async (...args: unknown[]) => {
    identificacoes.push(args);
    if (identidades instanceof Error) throw identidades;
    return identidades;
  },
}));

import { desconhecidosDaTranscricao, textoDaTranscricao, transcribeRecording } from "./transcribe";

const audio = new Uint8Array([1, 2, 3]);
const falas = [
  { speaker: "A", text: "bom dia", startMs: 0, endMs: 1000 },
  { speaker: "B", text: "entrego na sexta", startMs: 1000, endMs: 3000 },
];

beforeEach(() => {
  resultado = { text: "bom dia entrego na sexta", language: "pt", provider: "assemblyai", utterances: falas, speakers: 2 };
  dono = "dono";
  identidades = [{ label: "A", outcome: "identificado", personId: "p1", name: "Anna", score: 0.9, unknownLabel: null }];
  identificacoes.length = 0;
});

describe("transcrever uma gravação", () => {
  it("com diarização e sendo o dono, diz quem falou", async () => {
    const r = await transcribeRecording("dono", audio, "audio/webm", { diarize: true });
    expect(r.speakerIdentities).toHaveLength(1);
    expect(identificacoes).toHaveLength(1);
  });

  it("sem diarização (comando de voz) não roda reconhecimento de locutor", async () => {
    await transcribeRecording("dono", audio, "audio/webm", { diarize: false });
    expect(identificacoes).toEqual([]);
  });

  it("outra conta não passa pela biometria da casa", async () => {
    dono = "outra-pessoa";
    const r = await transcribeRecording("dono", audio, "audio/webm", { diarize: true });
    expect(r.speakerIdentities).toBeUndefined();
    expect(identificacoes).toEqual([]);
  });

  it("percepção fora do ar: a transcrição sai igual, sem nomes", async () => {
    identidades = new Error("percepção fora do ar");
    const r = await transcribeRecording("dono", audio, "audio/webm", { diarize: true });
    expect(r.text).toBe("bom dia entrego na sexta");
    expect(r.speakerIdentities).toBeUndefined();
  });

  it("relata o progresso em dois passos quando separa vozes", async () => {
    const passos: string[] = [];
    await transcribeRecording("dono", audio, "audio/webm", { diarize: true }, async (_f, _t, p) => void passos.push(p));
    expect(passos).toEqual(["transcrevendo o áudio", "reconhecendo quem falou"]);
  });
});

describe("texto para o resumo", () => {
  it("com locutores, cada fala leva o rótulo", () => {
    expect(textoDaTranscricao({ utterances: falas })).toBe("Locutor A: bom dia\nLocutor B: entrego na sexta");
  });
  it("sem locutores, o texto corrido", () => {
    expect(textoDaTranscricao({ text: "  só uma voz  " })).toBe("só uma voz");
  });
  it("só os desconhecidos viram rótulos para ligar à reunião", () => {
    expect(desconhecidosDaTranscricao({ speakerIdentities: [{ unknownLabel: null }, { unknownLabel: "Desconhecido 2" }] })).toEqual(["Desconhecido 2"]);
  });
});
