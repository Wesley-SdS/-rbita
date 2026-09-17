import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * As 12 tools de identidade com as dependências simuladas (CLAUDE.md §5.7:
 * tool sem teste de `execute` não está pronta). O que está sendo provado aqui é
 * o que o PRD §4 chama de inegociável:
 *   - cadastrar pessoa e apagar biometria NUNCA executam direto (gate)
 *   - quem pergunta só vê quem pode ver, e a consulta é auditada
 *   - olhar a câmera de um cômodo negado é recusado antes de chamar o modelo
 */

const pessoas = [
  { id: "p-wesley", name: "Wesley", role: "dono", relation: "morador", isMinor: false, guardianPersonId: null, aliases: [] },
  { id: "p-anna", name: "Anna", role: "morador", relation: "morador", isMinor: false, guardianPersonId: null, aliases: ["Aninha"] },
];
let visiveis = pessoas;
const auditadas: string[] = [];
const narradas: string[] = [];
let camera: { id: string; name: string; roomId: string | null; identifyFaces: boolean } | null = null;
let recusaComodo: string | null = null;

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../../identity/ask", () => ({
  askContext: async () => ({ viewer: null, policy: "negado", grants: [], people: pessoas }),
  visiblePeople: async (_u: string, _c: unknown, motivo: string) => {
    auditadas.push(motivo);
    return visiveis;
  },
  canAskAndAudit: async (_u: string, _c: unknown, subject: { id: string }, motivo: string) => {
    auditadas.push(motivo);
    return visiveis.some((p) => p.id === subject.id);
  },
  findPersonByName: (people: typeof pessoas, nome: string) => people.find((p) => p.name.toLowerCase() === nome.toLowerCase()) ?? null,
}));
vi.mock("../../identity/presence", () => ({
  currentPresence: async () => [{ personId: "p-anna", name: "Anna", roomId: "sala", roomName: "Sala", source: "camera", confidence: 0.9, seenAt: new Date(), quando: "agora" }],
}));
vi.mock("../../identity/people", () => ({
  createPerson: vi.fn(async () => ({ id: "p-nova" })),
  listPeople: async () => pessoas.map((p) => ({ ...p, consentimento: { voz: true, rosto: false } })),
  recordConsent: vi.fn(),
  currentTerm: async () => ({ text: "termo", version: "v1" }),
}));
vi.mock("../../identity/actions", () => ({
  apagarBiometriaDe: vi.fn(async () => ({ tabelas: ["biometric_voice_sample"], referencias: ["camera_event"] })),
  usarFalaComoAmostra: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../../vision/objects", () => ({
  findObject: async () => [{ label: "chave", roomName: "Cozinha", cameraName: "Cozinha", zone: null, score: 0.8, seenAt: new Date("2026-09-17T14:12:00Z") }],
  cameraDigest: async () => [
    { id: "e1", label: "person", zone: null, score: 0.9, createdAt: new Date(), cameraName: "Sala", roomName: "Sala", personId: "p-anna", outcome: "identificado", desconhecido: null, narration: "uma pessoa cozinhando" },
  ],
}));
vi.mock("../../meetings/quem-disse", () => ({
  quemDisse: async () => [{ documentId: "d1", titulo: "Reunião", quando: new Date(), locutor: "A", nome: "Anna", trecho: "entrego na sexta" }],
}));
vi.mock("../../cameras/query", () => ({
  findCamera: async () => camera,
  latestEventWithSnapshot: async () => ({ id: "e1", snapshot: "data:image/jpeg;base64,AA", createdAt: new Date() }),
  cameraRoomName: async () => "Quarto",
}));
vi.mock("../../cameras/narrate", () => ({
  narrateCameraEvent: async (id: string) => {
    narradas.push(id);
    return "cena narrada";
  },
  narrateSnapshot: async () => {
    narradas.push("snapshot");
    return "resposta da imagem";
  },
}));
vi.mock("../../home/room-permission", () => ({ authorizeRoomForRequester: async () => recusaComodo }));

import { needsApproval } from "../registry";
import {
  apagar_biometria,
  cadastrar_pessoa,
  o_que_esta_acontecendo,
  onde_esta,
  procurar_objeto,
  quem_disse,
  quem_esta_em_casa,
  resumo_do_dia_cameras,
  ver_camera,
} from "./identidade";

const ctx = { userId: "dono" };

beforeEach(() => {
  vi.clearAllMocks();
  visiveis = pessoas;
  auditadas.length = 0;
  narradas.length = 0;
  recusaComodo = null;
  camera = { id: "cam1", name: "Quarto", roomId: "quarto", identifyFaces: true };
});

describe("gate das tools perigosas", () => {
  it("cadastrar pessoa e apagar biometria exigem aprovação do dono", () => {
    expect(needsApproval(cadastrar_pessoa.risk)).toBe(true);
    expect(needsApproval(apagar_biometria.risk)).toBe(true);
    // leitura roda direto, senão a Órbita ficaria inutilizável
    expect(needsApproval(quem_esta_em_casa.risk)).toBe(false);
  });

  it("apagar biometria devolve só o que foi limpo, sem dado biométrico", async () => {
    const r = (await apagar_biometria.run({ pessoa: "Anna" }, ctx)) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, pessoa: "Anna", consentimentoRevogado: true });
    expect(JSON.stringify(r)).not.toMatch(/vector|embedding|audio/i);
  });

  it("apagar biometria de quem não existe não apaga nada", async () => {
    const { apagarBiometriaDe } = await import("../../identity/actions");
    expect(await apagar_biometria.run({ pessoa: "Fulano" }, ctx)).toMatchObject({ erro: expect.stringContaining("Não encontrei") });
    expect(apagarBiometriaDe).not.toHaveBeenCalled();
  });

  it("cadastrar pessoa não cadastra biometria junto", async () => {
    const r = (await cadastrar_pessoa.run({ nome: "Novo", relacao: "morador", menorDeIdade: false }, ctx)) as { aviso: string };
    expect(r.aviso).toMatch(/sem biometria/i);
  });
});

describe("permissão sobre pessoas", () => {
  it("quem está em casa só mostra quem quem pergunta pode ver, e audita", async () => {
    visiveis = [pessoas[0]!];
    const r = (await quem_esta_em_casa.run({}, ctx)) as { pessoas: { nome: string }[] };
    expect(r.pessoas.map((p) => p.nome)).toEqual(["Wesley"]);
    expect(auditadas).toContain("quem_esta_em_casa");
  });

  it("onde está recusa quando não pode perguntar sobre a pessoa", async () => {
    visiveis = [pessoas[0]!];
    expect(await onde_esta.run({ pessoa: "Anna" }, ctx)).toMatchObject({ erro: expect.stringContaining("permissão") });
    expect(auditadas).toContain("onde_esta");
  });

  it("onde está responde com a idade do avistamento, não só o cômodo", async () => {
    const r = (await onde_esta.run({ pessoa: "Anna" }, ctx)) as Record<string, unknown>;
    expect(r).toMatchObject({ pessoa: "Anna", comodo: "Sala", quando: "agora" });
  });

  it("resumo do dia esconde nome E narração de quem não pode ser consultado", async () => {
    visiveis = [pessoas[0]!];
    const r = (await resumo_do_dia_cameras.run({ horas: 12 }, ctx)) as { eventos: { quem: string; descricao?: string }[] };
    expect(r.eventos[0]!.quem).toBe("alguém da casa");
    expect(r.eventos[0]!.descricao).toBeUndefined();
  });

  it("resumo do dia mostra nome e descrição para quem pode", async () => {
    const r = (await resumo_do_dia_cameras.run({ horas: 12 }, ctx)) as { eventos: { quem: string; descricao?: string }[] };
    expect(r.eventos[0]!).toMatchObject({ quem: "Anna", descricao: "uma pessoa cozinhando" });
  });

  it("quem disse esconde o nome do locutor sem permissão", async () => {
    visiveis = [pessoas[0]!];
    const r = (await quem_disse.run({ assunto: "entrega sexta", pessoa: null }, ctx)) as { falas: { quem: string }[] };
    expect(r.falas[0]!.quem).toBe("Locutor A");
    expect(auditadas).toContain("quem_disse");
  });

  it("quem disse recusa quando a pergunta é sobre pessoa proibida", async () => {
    visiveis = [pessoas[0]!];
    expect(await quem_disse.run({ assunto: "entrega", pessoa: "Anna" }, ctx)).toMatchObject({ erro: expect.stringContaining("permissão") });
  });
});

describe("câmera: permissão por cômodo antes do modelo de visão", () => {
  it("authorize recusa e o modelo nem é chamado", async () => {
    recusaComodo = "Quem pediu não tem permissão para ver a câmera neste cômodo.";
    expect(await o_que_esta_acontecendo.authorize!({ comodo: "quarto" }, ctx)).toBe(recusaComodo);
    expect(await ver_camera.authorize!({ local: "quarto", pergunta: "quem está aí?" }, ctx)).toBe(recusaComodo);
    expect(narradas).toEqual([]);
  });

  it("com permissão, reaproveita a narração já gravada do evento", async () => {
    const r = (await o_que_esta_acontecendo.run({ comodo: "quarto" }, ctx)) as { descricao: string; pessoas: unknown[] };
    expect(r.descricao).toBe("cena narrada");
    expect(narradas).toEqual(["e1"]);
  });

  it("câmera inexistente responde sem chamar o modelo", async () => {
    camera = null;
    expect(await ver_camera.run({ local: "garagem", pergunta: "tem carro?" }, ctx)).toMatchObject({ erro: expect.stringContaining("Não achei") });
    expect(narradas).toEqual([]);
  });
});

describe("memória visual", () => {
  it("diz onde e quando viu", async () => {
    const r = (await procurar_objeto.run({ objeto: "chave" }, ctx)) as { ondeFoiVisto: { comodo: string }[] };
    expect(r.ondeFoiVisto[0]!.comodo).toBe("Cozinha");
  });
});
