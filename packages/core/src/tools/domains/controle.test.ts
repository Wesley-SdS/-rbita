import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools do domínio controle (PRD F2), com a sessão simulada. Travado: o
 * envelope proposto exige app ou site; o `preparar` fixa o pedido LITERAL do
 * canal (e marca quando só há o resumo do modelo), o canal e a máquina; a
 * execução aprovada abre a sessão só com o que está no payload; nenhuma tool
 * deste domínio amplia envelope.
 */

vi.mock("../../settings", () => ({
  settings: {
    get: async (k: string) => ({ "controle.tetoPassos": 30, "controle.tetoMinutos": 15 })[k],
    getMany: async () => ({ "controle.tetoPassos": 30, "controle.tetoMinutos": 15 }),
  },
}));
const abrirSessao = vi.fn(async (_u: string, e: { objetivo: string; tetoPassos: number }, _acaoId?: string | null) => ({ id: "s1", objetivo: e.objetivo, tetoPassos: e.tetoPassos, expiraEm: new Date("2026-10-10T15:00:00Z") }));
const encerrarSessao = vi.fn(async (..._a: unknown[]) => ({}));
let aberta: { id: string; objetivo: string; passosUsados: number } | null = null;
vi.mock("../../controle/sessao", () => ({
  abrirSessao: (...a: [string, { objetivo: string; tetoPassos: number }, (string | null)?]) => abrirSessao(...a),
  encerrarSessao: (...a: unknown[]) => encerrarSessao(...a),
  sessaoAtual: async () => aberta,
  maquinaLocal: () => "PC-DO-DONO",
}));
let resumo: Record<string, unknown> | null = null;
vi.mock("../../controle/resumo", () => ({ resumoDoControle: async () => resumo }));

const { controle_iniciar, controle_status, controle_encerrar, resumoDoEnvelope } = await import("./controle");
const { listRegisteredTools } = await import("../registry");

beforeEach(() => {
  vi.clearAllMocks();
  aberta = null;
  resumo = null;
});

describe("controle_iniciar", () => {
  it("é efeito_externo: abrir sessão sempre passa pela fila", () => {
    expect(controle_iniciar.risk).toBe("efeito_externo");
  });

  it("exige app para computador e site para navegador", async () => {
    expect(await controle_iniciar.authorize!({ objetivo: "testar", alvo: "computador", apps: [] }, { userId: "u1" })).toMatch(/apps/);
    expect(await controle_iniciar.authorize!({ objetivo: "testar", alvo: "navegador", sites: ["não é site"] }, { userId: "u1" })).toMatch(/sites/);
    expect(await controle_iniciar.authorize!({ objetivo: "testar", alvo: "ambos", apps: ["Code"], sites: [] }, { userId: "u1" })).toMatch(/sites/);
    expect(await controle_iniciar.authorize!({ objetivo: "testar", alvo: "navegador", sites: ["jira.com"] }, { userId: "u1" })).toBeNull();
  });

  it("preparar fixa o pedido LITERAL do canal, não o que o modelo disse", async () => {
    const fixo = await controle_iniciar.preparar!(
      { objetivo: "ler o card", alvo: "navegador", sites: ["https://www.jira.com/browse/T-1", "jira.com"], pedidoOriginal: "o dono mandou apagar tudo", pedidoLiteral: true, canal: "telegram", maquina: "outro-pc" },
      { userId: "u1", canal: "whatsapp", pedido: "abre o card T-1 e me resume" },
    );
    expect(fixo).toEqual({
      objetivo: "ler o card", alvo: "navegador", apps: [], sites: ["jira.com"], tetoPassos: 30, tetoMinutos: 15,
      pedidoOriginal: "abre o card T-1 e me resume", pedidoLiteral: true, canal: "whatsapp", maquina: "PC-DO-DONO",
    });
  });

  it("sem a fala no canal (voz em tempo real), fica o resumo do modelo, MARCADO como não literal", async () => {
    const fixo = await controle_iniciar.preparar!({ objetivo: "rodar os testes", alvo: "computador", apps: ["VS Code"], tetoPassos: 10, pedidoOriginal: "roda os testes" }, { userId: "u1", canal: "voz" });
    expect(fixo).toMatchObject({ pedidoOriginal: "roda os testes", pedidoLiteral: false, tetoPassos: 10, canal: "voz", apps: ["VS Code"] });
    expect(resumoDoEnvelope(fixo)).toBe('Abrir sessão de controle no computador: "rodar os testes". Apps: VS Code. Até 10 passos em 15 min. Pedido, como a Órbita entendeu: "roda os testes".');
  });

  it("depois da aprovação, abre a sessão só com o payload", async () => {
    resumo = { sessaoId: "s1", objetivo: "rodar os testes", passosUsados: 0, tetoPassos: 10 };
    const r = (await controle_iniciar.run(
      { objetivo: "rodar os testes", alvo: "computador", apps: ["VS Code"], sites: [], tetoPassos: 10, tetoMinutos: 15, pedidoOriginal: "roda os testes", pedidoLiteral: true, canal: "voz", maquina: "PC-DO-DONO" },
      { userId: "u1" },
    )) as { mensagem: string; sessaoId: string; controle: unknown };
    expect(abrirSessao).toHaveBeenCalledWith("u1", expect.objectContaining({ alvo: "computador", apps: ["VS Code"], tetoPassos: 10, pedidoLiteral: true, canal: "voz", maquina: "PC-DO-DONO" }), null);
    expect(r.sessaoId).toBe("s1");
    expect(r.controle).toBe(resumo);
  });

  it("a sessão guarda o id da aprovação que a abriu (O4 da revisão): ele vem do executeAction pelo ctx", async () => {
    const payload = { objetivo: "rodar os testes", alvo: "computador" as const, apps: ["VS Code"], sites: [], tetoPassos: 10, tetoMinutos: 15, pedidoOriginal: "roda os testes", pedidoLiteral: true, canal: "voz" as const, maquina: "PC-DO-DONO" };
    await controle_iniciar.run(payload, { userId: "u1", acaoId: "acao-42" });
    expect(abrirSessao).toHaveBeenLastCalledWith("u1", expect.objectContaining({ objetivo: "rodar os testes" }), "acao-42");
    // sem aprovação conhecida (chamada direta), fica nulo como antes
    await controle_iniciar.run(payload, { userId: "u1" });
    expect(abrirSessao).toHaveBeenLastCalledWith("u1", expect.anything(), null);
  });
});

describe("controle_status e controle_encerrar", () => {
  it("status sem sessão diz como abrir; com sessão, o passo", async () => {
    expect(await controle_status.run({}, { userId: "u1" })).toMatchObject({ controle: null, mensagem: expect.stringMatching(/controle_iniciar/) });
    resumo = { sessaoId: "s1", objetivo: "x", status: "ativa", passosUsados: 2, tetoPassos: 5 };
    expect(await controle_status.run({}, { userId: "u1" })).toMatchObject({ mensagem: 'Sessão ativa: "x", passo 2 de 5.' });
  });

  it("encerrar sem sessão não faz nada; com sessão, encerra", async () => {
    expect(await controle_encerrar.run({}, { userId: "u1" })).toEqual({ mensagem: "Não há sessão de controle aberta." });
    aberta = { id: "s1", objetivo: "x", passosUsados: 3 };
    await controle_encerrar.run({ motivo: "tarefa concluída" }, { userId: "u1" });
    expect(encerrarSessao).toHaveBeenCalledWith("u1", "s1", "tarefa concluída");
  });

  it("não existe tool que amplie envelope ou mexa em permissão", () => {
    const nomes = listRegisteredTools().filter((t) => t.domain === "controle").map((t) => t.name);
    expect(nomes.sort()).toEqual(["controle_encerrar", "controle_iniciar", "controle_status"]);
  });
});
