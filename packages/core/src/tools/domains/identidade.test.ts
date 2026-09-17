import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * As 12 tools de identidade com as dependências simuladas (CLAUDE.md §5.7:
 * tool sem teste de `execute` não está pronta). O que está sendo provado aqui é
 * o que o PRD §4 chama de inegociável:
 *   - cadastrar pessoa e apagar biometria NUNCA executam direto (gate)
 *   - quem pergunta só vê quem pode ver, e a consulta é auditada
 *   - olhar a câmera de um cômodo negado é recusado antes de chamar o modelo
 *   - o que as câmeras viram é filtrado por CÔMODO, não só por pessoa: um
 *     evento ou um objeto do quarto já entrega o quarto (Fase 2)
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
let comodosProibidos: string[] = [];
let documentos: { id: string; speakers: Record<string, string> | null }[] = [];
const gravados: Record<string, unknown>[] = [];

// banco só é tocado por `nomear_locutor` (a reunião e os locutores dela)
vi.mock("@orbita/db", () => {
  const cadeia = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const k of ["select", "from", "where", "limit", "update", "set"]) {
      p[k] = (...args: unknown[]) => {
        if (k === "set") gravados.push(args[0] as Record<string, unknown>);
        return p;
      };
    }
    (p as { then: unknown }).then = (ok: (v: unknown) => void) => ok(documentos);
    return p;
  };
  return { db: cadeia() };
});
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
  findObject: async () => [
    { label: "chave", roomId: "sala", roomName: "Cozinha", cameraName: "Cozinha", zone: null, score: 0.8, seenAt: new Date("2026-09-17T14:12:00Z") },
    { label: "chave", roomId: "quarto", roomName: "Quarto", cameraName: "Quarto", zone: null, score: 0.7, seenAt: new Date("2026-09-17T09:00:00Z") },
  ],
  cameraDigest: async () => [
    { id: "e1", label: "person", roomId: "sala", zone: null, score: 0.9, createdAt: new Date(), cameraName: "Sala", roomName: "Sala", personId: "p-anna", outcome: "identificado", desconhecido: null, narration: "uma pessoa cozinhando" },
    { id: "e2", label: "person", roomId: "quarto", zone: null, score: 0.8, createdAt: new Date(), cameraName: "Quarto", roomName: "Quarto", personId: null, outcome: "desconhecido", desconhecido: "Desconhecido 1", narration: "alguém entrando no quarto" },
  ],
  knownObjectLabels: async () => ["chave", "mochila"],
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
vi.mock("../../home/room-permission", () => ({
  authorizeRoomForRequester: async () => recusaComodo,
  // sem quem pede identificado é o dono falando: vê a casa inteira. Com quem
  // pede, os cômodos proibidos somem da lista, como faz o `allowedRooms` real.
  allowedRooms: async (roomIds: readonly (string | null)[], quem: unknown) =>
    new Set(quem ? [...new Set(roomIds)].filter((r) => !comodosProibidos.includes(String(r))) : roomIds),
}));

import { needsApproval, type Requester, type ToolContext } from "../registry";
import {
  apagar_biometria,
  cadastrar_pessoa,
  listar_pessoas_da_casa,
  nomear_locutor,
  o_que_esta_acontecendo,
  onde_esta,
  procurar_objeto,
  quem_disse,
  quem_esta_em_casa,
  resumo_do_dia_cameras,
  usar_fala_como_amostra,
  ver_camera,
} from "./identidade";

const ctx: ToolContext = { userId: "dono" };
const anna: Requester = { personId: "p-anna", name: "Anna", role: "morador", via: "voz", confidence: 0.9 };
/** mesma pergunta, feita por quem não é o dono: é o que aciona o filtro por cômodo */
const ctxAnna: ToolContext = { userId: "dono", requester: async () => anna };
const REUNIAO = "9f1c0d3e-7a2b-4c5d-8e6f-0a1b2c3d4e5f";

beforeEach(() => {
  vi.clearAllMocks();
  visiveis = pessoas;
  auditadas.length = 0;
  narradas.length = 0;
  gravados.length = 0;
  recusaComodo = null;
  comodosProibidos = [];
  documentos = [{ id: REUNIAO, speakers: { B: "Wesley" } }];
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

/**
 * Filtro por CÔMODO (Fase 2). Esconder só o nome não bastava: "movimento no
 * quarto às 2h" e "sua chave está no quarto" entregam o quarto sozinhos.
 */
describe("permissão por cômodo no que as câmeras viram", () => {
  it("o dono vê os eventos de todos os cômodos", async () => {
    const r = (await resumo_do_dia_cameras.run({ horas: 12 }, ctx)) as { eventos: { comodo: string }[] };
    expect(r.eventos.map((e) => e.comodo)).toEqual(["Sala", "Quarto"]);
  });

  it("quem não tem acesso ao quarto não vê o evento do quarto", async () => {
    comodosProibidos = ["quarto"];
    const r = (await resumo_do_dia_cameras.run({ horas: 12 }, ctxAnna)) as { eventos: { comodo: string; descricao?: string }[] };
    expect(r.eventos.map((e) => e.comodo)).toEqual(["Sala"]);
    expect(JSON.stringify(r)).not.toMatch(/quarto/i);
  });

  it("sem nenhum cômodo permitido, o resumo fica vazio em vez de vazar", async () => {
    comodosProibidos = ["sala", "quarto"];
    const r = (await resumo_do_dia_cameras.run({ horas: 12 }, ctxAnna)) as { eventos: unknown[]; resposta?: string };
    expect(r.eventos).toEqual([]);
    expect(r.resposta).toMatch(/Nenhuma câmera registrou/);
  });

  it("o dono acha o objeto em qualquer cômodo", async () => {
    const r = (await procurar_objeto.run({ objeto: "chave" }, ctx)) as { ondeFoiVisto: { comodo: string }[] };
    expect(r.ondeFoiVisto.map((v) => v.comodo)).toEqual(["Cozinha", "Quarto"]);
  });

  it("quem não tem acesso ao quarto não sabe que a chave está lá", async () => {
    comodosProibidos = ["quarto"];
    const r = (await procurar_objeto.run({ objeto: "chave" }, ctxAnna)) as { ondeFoiVisto: { comodo: string }[] };
    expect(r.ondeFoiVisto.map((v) => v.comodo)).toEqual(["Cozinha"]);
  });

  it("objeto visto só em cômodo proibido responde como se não tivesse sido visto", async () => {
    comodosProibidos = ["sala", "quarto"];
    const r = (await procurar_objeto.run({ objeto: "chave" }, ctxAnna)) as { resposta: string; ondeFoiVisto?: unknown; objetosQueLembro?: string[] };
    expect(r.ondeFoiVisto).toBeUndefined();
    expect(r.resposta).toMatch(/Não vi esse objeto/);
    // a lista do dono não é segredo de cômodo: segue ajudando a próxima pergunta
    expect(r.objetosQueLembro).toEqual(["chave", "mochila"]);
  });
});

describe("reuniões e pessoas: as tools de escrita e listagem", () => {
  it("nomear locutor grava o nome na reunião, em caixa alta, sem apagar os outros", async () => {
    const r = await nomear_locutor.run({ reuniaoId: REUNIAO, locutor: "a", pessoa: "Anna" }, ctx);
    expect(r).toEqual({ ok: true, locutor: "A", pessoa: "Anna" });
    expect(gravados).toEqual([{ speakers: { A: "Anna", B: "Wesley" } }]);
  });

  it("nomear locutor com pessoa que não existe não grava nada", async () => {
    expect(await nomear_locutor.run({ reuniaoId: REUNIAO, locutor: "A", pessoa: "Fulano" }, ctx)).toMatchObject({
      erro: expect.stringContaining("Não encontrei"),
    });
    expect(gravados).toEqual([]);
  });

  it("nomear locutor de reunião inexistente não grava nada", async () => {
    documentos = [];
    expect(await nomear_locutor.run({ reuniaoId: REUNIAO, locutor: "A", pessoa: "Anna" }, ctx)).toMatchObject({ erro: "Reunião não encontrada." });
    expect(gravados).toEqual([]);
  });

  it("usar fala como amostra dispara a fachada de identidade, nunca toca no vetor", async () => {
    const { usarFalaComoAmostra } = await import("../../identity/actions");
    const r = await usar_fala_como_amostra.run({ pessoa: "Anna", ref: REUNIAO }, ctx);
    expect(r).toEqual({ ok: true, pessoa: "Anna" });
    expect(usarFalaComoAmostra).toHaveBeenCalledWith("dono", "p-anna", REUNIAO, "correcao");
    expect(JSON.stringify(r)).not.toMatch(/vector|embedding|audio/i);
  });

  it("usar fala como amostra de quem não existe não chama a fachada", async () => {
    const { usarFalaComoAmostra } = await import("../../identity/actions");
    expect(await usar_fala_como_amostra.run({ pessoa: "Fulano", ref: REUNIAO }, ctx)).toMatchObject({
      erro: expect.stringContaining("Não encontrei"),
    });
    expect(usarFalaComoAmostra).not.toHaveBeenCalled();
  });

  it("as duas são de escrita: rodam direto, sem fila de aprovação", () => {
    expect(needsApproval(nomear_locutor.risk)).toBe(false);
    expect(needsApproval(usar_fala_como_amostra.risk)).toBe(false);
  });

  it("listar pessoas da casa diz quem tem voz e rosto cadastrados", async () => {
    const r = (await listar_pessoas_da_casa.run({}, ctx)) as { pessoas: Record<string, unknown>[] };
    expect(r.pessoas).toEqual([
      { nome: "Wesley", relacao: "morador", menorDeIdade: false, voz: true, rosto: false },
      { nome: "Anna", relacao: "morador", menorDeIdade: false, voz: true, rosto: false },
    ]);
    expect(auditadas).toContain("listar_pessoas_da_casa");
  });

  it("listar pessoas esconde quem quem pergunta não pode ver", async () => {
    visiveis = [pessoas[1]!];
    const r = (await listar_pessoas_da_casa.run({}, ctxAnna)) as { pessoas: { nome: string }[] };
    expect(r.pessoas.map((p) => p.nome)).toEqual(["Anna"]);
    expect(auditadas).toContain("listar_pessoas_da_casa");
  });
});
