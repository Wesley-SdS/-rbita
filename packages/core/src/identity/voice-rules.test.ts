import { describe, expect, it, vi } from "vitest";

// voice.ts e requester.ts tocam banco e percepção; aqui só as partes puras
vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../perception/client", () => ({}));

import { nextUnknownNumber, pickSpeakerSegments, resolveDuplicates } from "./voice";
import { chooseRequester, parseVoiceClip } from "./requester";
import type { Requester } from "../tools/registry";

const conta: Requester = { personId: "w", name: "Wesley", role: "dono", via: "conta" };
const anna: Requester = { personId: "a", name: "Anna", role: "morador", via: "voz", confidence: 0.9 };

describe("quem pede", () => {
  it("sem trecho de voz vale a conta", () => {
    expect(chooseRequester(conta, null, "conta")).toBe(conta);
  });

  it("voz reconhecida com confiança troca quem pede", () => {
    expect(chooseRequester(conta, { outcome: "identificado", person: anna }, "conta")).toBe(anna);
  });

  it("voz só provável NÃO troca quem pede (fala curta, parecida)", () => {
    expect(chooseRequester(conta, { outcome: "provavel", person: anna }, "conta")).toBe(conta);
  });

  it("política restrita: identificação que FALHOU com trecho presente também vira visitante", () => {
    expect(chooseRequester(conta, null, "restrito", true)).toMatchObject({ role: "visitante" });
    // sem trecho de voz (mensagem digitada) vale a conta
    expect(chooseRequester(conta, null, "restrito", false)).toBe(conta);
    expect(chooseRequester(conta, null, "conta", true)).toBe(conta);
  });

  it("política restrita: voz não reconhecida vira visitante", () => {
    expect(chooseRequester(conta, { outcome: "desconhecido", person: null }, "restrito")).toMatchObject({ role: "visitante", personId: null, via: "voz" });
    expect(chooseRequester(conta, { outcome: "provavel", person: anna }, "restrito").role).toBe("visitante");
  });
});

describe("trecho de voz do comando", () => {
  const b64 = Buffer.from("abc").toString("base64");

  it("lê data URL com codec", () => {
    const c = parseVoiceClip(`data:audio/webm;codecs=opus;base64,${b64}`, 10);
    expect(c?.mime).toBe("audio/webm");
    expect(c?.bytes.length).toBe(3);
  });

  it("recusa formato errado, vazio e acima do teto", () => {
    expect(parseVoiceClip("nao-e-data-url", 10)).toBeNull();
    expect(parseVoiceClip("data:audio/webm;base64,", 10)).toBeNull();
    expect(parseVoiceClip(`data:audio/webm;base64,${Buffer.alloc(3000).toString("base64")}`, 2)).toBeNull();
  });
});

describe("falas de reunião por locutor", () => {
  const u = (speaker: string, s: number, e: number) => ({ speaker, startMs: s * 1000, endMs: e * 1000 });

  it("pega as mais longas até o teto, por locutor", () => {
    const m = pickSpeakerSegments([u("A", 0, 2), u("A", 2, 12), u("B", 12, 13), u("A", 13, 20)], 12);
    // a de 10 s entra inteira; a seguinte é cortada nos 2 s que faltam para o teto
    expect(m.get("A")).toEqual([{ start: 2, end: 12 }, { start: 13, end: 15 }]);
    expect(m.get("B")).toEqual([{ start: 12, end: 13 }]);
  });

  it("fala longa é cortada no teto (monólogo não vira trecho enorme)", () => {
    const m = pickSpeakerSegments([u("A", 0, 1500)], 40);
    expect(m.get("A")).toEqual([{ start: 0, end: 40 }]);
  });

  it("ignora fala de duração zero", () => {
    expect(pickSpeakerSegments([u("A", 5, 5)], 10).size).toBe(0);
  });
});

describe("numeração de desconhecido", () => {
  it("maior número já usado + 1, mesmo com buracos e expirados", () => {
    expect(nextUnknownNumber([])).toBe(1);
    expect(nextUnknownNumber(["Desconhecido 2"])).toBe(3);
    expect(nextUnknownNumber(["Desconhecido 1", "Desconhecido 7", "Desconhecido 3"])).toBe(8);
  });
});

describe("duas etiquetas, mesma pessoa", () => {
  it("fica a de maior escore; a outra volta a ser desconhecida", () => {
    const r = resolveDuplicates(
      new Map([
        ["A", { personId: "w", score: 0.9, outcome: "identificado" }],
        ["B", { personId: "w", score: 0.78, outcome: "identificado" }],
        ["C", { personId: null, score: 0.2, outcome: "desconhecido" }],
      ]),
    );
    expect(r.get("A")!.personId).toBe("w");
    expect(r.get("B")).toMatchObject({ personId: null, outcome: "desconhecido" });
    expect(r.get("C")!.outcome).toBe("desconhecido");
  });
});
