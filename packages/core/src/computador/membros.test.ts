import { describe, expect, it } from "vitest";
import { ABRIR_APLICATIVO, ferramentasDoComputador, MEMBROS, MEMBROS_FORA, MEMBROS_LIGADOS, toolsetDoComputador, traduzirMembro } from "./membros";
import type { CapturaVista } from "./escala";

const CAP: CapturaVista = { id: "c1", largura: 1280, altura: 720 };
const T = (nome: string, entrada: Record<string, unknown> = {}, cap: CapturaVista | null = CAP) => traduzirMembro(nome, entrada, cap, 30_000);

describe("o toolset", () => {
  it("cobre os 17 membros: 13 ligados e 4 desligados no configs, sem name nem tamanho de tela", () => {
    expect(MEMBROS).toHaveLength(17);
    expect(MEMBROS_LIGADOS).toHaveLength(13);
    expect(MEMBROS_FORA).toEqual(["mouse_move", "left_mouse_down", "left_mouse_up", "hold_key"]);
    const t = toolsetDoComputador();
    expect(t.type).toBe("computer_toolset_20260801");
    expect(Object.keys(t.configs as object).sort()).toEqual([...MEMBROS_FORA].sort());
    for (const m of MEMBROS_FORA) expect((t.configs as Record<string, unknown>)[m]).toEqual({ enabled: false });
    expect(t).not.toHaveProperty("name");
    expect(t).not.toHaveProperty("display_width_px");
    expect(t).not.toHaveProperty("display_height_px");
  });

  it("todo membro ligado tem tradução (nenhum cai em desconhecido)", () => {
    for (const m of MEMBROS_LIGADOS) {
      const p = T(m, { coordinate: [10, 10], start_coordinate: [5, 5], text: "a", region: [0, 0, 100, 100], scroll_direction: "down", duration: 1 });
      expect(p.tipo, m).not.toBe("erro");
    }
  });

  it("membro desligado ou desconhecido vira erro, e nunca vira ação", () => {
    for (const m of MEMBROS_FORA) expect(T(m, { coordinate: [1, 1] })).toMatchObject({ tipo: "erro", texto: expect.stringMatching(/not enabled/) });
    expect(T("format_disk")).toMatchObject({ tipo: "erro", texto: expect.stringMatching(/not a known/) });
  });
});

describe("abrir aplicativo (ferramenta própria ao lado do toolset)", () => {
  it("vai no campo tools depois do toolset, com schema que exige app", () => {
    const t = ferramentasDoComputador();
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual(toolsetDoComputador());
    expect(t[1]).toMatchObject({ name: ABRIR_APLICATIVO, input_schema: { required: ["app"] } });
  });
  it("traduz para abrir o app pelo nome, e recusa vazio ou longo demais", () => {
    expect(T(ABRIR_APLICATIVO, { app: "  Calculadora " })).toEqual({ tipo: "abrir", app: "Calculadora" });
    expect(T(ABRIR_APLICATIVO, {})).toMatchObject({ tipo: "erro" });
    expect(T(ABRIR_APLICATIVO, { app: "x".repeat(121) })).toMatchObject({ tipo: "erro" });
  });
});

describe("tradução dos membros ligados", () => {
  it("cliques viram a ação certa com o alvo na captura e o modificador", () => {
    expect(T("left_click", { coordinate: [640, 360] })).toEqual({ tipo: "agir", passo: { acao: "clicar", alvo: { captura: "c1", x: 640, y: 360 } } });
    expect(T("double_click", { coordinate: [1, 2], text: "ctrl" })).toMatchObject({ passo: { acao: "clique_duplo", modificadores: "ctrl" } });
    expect(T("right_click", { coordinate: [1, 2] })).toMatchObject({ passo: { acao: "clique_direito" } });
    expect(T("middle_click", { coordinate: [1, 2] })).toMatchObject({ passo: { acao: "clique_meio" } });
    expect(T("triple_click", { coordinate: [1, 2] })).toMatchObject({ passo: { acao: "clique_triplo" } });
  });

  it("clique sem screenshot ou fora da imagem é erro", () => {
    expect(T("left_click", { coordinate: [1, 1] }, null)).toMatchObject({ tipo: "erro" });
    expect(T("left_click", { coordinate: [9999, 1] })).toMatchObject({ tipo: "erro", texto: expect.stringMatching(/fora/) });
  });

  it("arrastar só com as DUAS pontas resolvidas", () => {
    expect(T("left_click_drag", { start_coordinate: [10, 10], coordinate: [200, 200] })).toEqual({ tipo: "agir", passo: { acao: "arrastar", alvo: { captura: "c1", x: 10, y: 10 }, destino: { captura: "c1", x: 200, y: 200 } } });
    expect(T("left_click_drag", { coordinate: [200, 200] })).toMatchObject({ tipo: "erro", texto: expect.stringMatching(/Origem/) });
    expect(T("left_click_drag", { start_coordinate: [10, 10], coordinate: [9999, 9999] })).toMatchObject({ tipo: "erro", texto: expect.stringMatching(/Destino/) });
  });

  it("scroll traduz a direção e limita a quantidade; com ponto leva o alvo", () => {
    expect(T("scroll", { scroll_direction: "down", scroll_amount: 5 })).toEqual({ tipo: "agir", passo: { acao: "rolar", direcao: "baixo", quantidade: 5 } });
    expect(T("scroll", { scroll_direction: "up", scroll_amount: 900, coordinate: [100, 100] })).toMatchObject({ passo: { acao: "rolar", direcao: "cima", quantidade: 50, alvo: { captura: "c1", x: 100, y: 100 } } });
    expect(T("scroll", { scroll_direction: "sideways" })).toMatchObject({ tipo: "erro" });
  });

  it("type vira digitar (com teto) e key separa tecla de atalho, com repeat limitado", () => {
    expect(T("type", { text: "comprar leite" })).toEqual({ tipo: "agir", passo: { acao: "digitar", texto: "comprar leite" } });
    expect(T("type", { text: "" })).toMatchObject({ tipo: "erro" });
    expect(T("type", { text: "x".repeat(5001) })).toMatchObject({ tipo: "erro" });
    expect(T("key", { text: "Enter" })).toEqual({ tipo: "agir", passo: { acao: "tecla", tecla: "Enter" } });
    expect(T("key", { text: "ctrl+s" })).toEqual({ tipo: "agir", passo: { acao: "atalho", tecla: "ctrl+s" } });
    expect(T("key", { text: "Down", repeat: 500 })).toMatchObject({ passo: { quantidade: 50 } });
  });

  it("zoom, wait e cursor_position são leitura ou espera, nunca ação", () => {
    expect(T("zoom", { region: [100, 100, 300, 300] })).toEqual({ tipo: "zoom", regiao: { captura: "c1", x0: 100, y0: 100, x1: 300, y1: 300 } });
    expect(T("zoom", { region: [1, 1, 2, 2] })).toMatchObject({ tipo: "erro" });
    expect(T("wait", { duration: 2 })).toEqual({ tipo: "esperar", seg: 2 });
    expect(T("wait", { duration: 300 })).toEqual({ tipo: "esperar", seg: 30 });
    expect(T("cursor_position")).toEqual({ tipo: "cursor" });
    expect(T("screenshot")).toEqual({ tipo: "tela" });
  });
});
