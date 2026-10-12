import { describe, expect, it } from "vitest";
import { ferramentasDoLaco, rodarComModeloDaCasa, SYSTEM_DA_ORBITA, TOOLS_DO_LACO } from "./motor-orbita";

/**
 * A reserva sem o Claude (PRD-MOTOR-DESKTOP §7.7): o modelo da casa recebe só as
 * três tools da tela, por lista de permitidas.
 */
describe("ferramentasDoLaco", () => {
  const tudo = Object.fromEntries(["computador_ver", "computador_agir", "computador_abrir", "computador_tarefa", "computador_encerrar_processo", "computador_midia", "terminal_executar", "arquivos_escrever", "navegador_tarefa", "enviar_whatsapp", "controle_iniciar"].map((n) => [n, { nome: n }]));

  it("deixa só ver, agir e abrir: nem terminal, arquivos, envio, MCP, a própria tarefa ou mídia", () => {
    expect(Object.keys(ferramentasDoLaco(tudo)).sort()).toEqual([...TOOLS_DO_LACO].sort());
  });

  it("tool nova no registro NÃO entra sozinha (lista de permitidas, não de bloqueadas)", () => {
    expect(ferramentasDoLaco({ ...tudo, computador_futura: { nome: "x" } })).not.toHaveProperty("computador_futura");
  });
});

describe("rodarComModeloDaCasa", () => {
  it("gera com o system da reserva, o contexto e o objetivo, só com as tools do laço", async () => {
    let visto: { system: string; prompt: string; tools: string[]; maxSteps: number } | null = null;
    const r = await rodarComModeloDaCasa(
      { objetivo: "anotar: comprar leite", contexto: "uma tentativa anterior parou", maxSteps: 8 },
      {
        montarTools: async () => ({ computador_ver: 1, computador_agir: 2, terminal_executar: 3 }),
        gerar: async (a) => ((visto = { system: a.system, prompt: a.prompt, tools: Object.keys(a.tools), maxSteps: a.maxSteps }), "Anotei."),
      },
    );
    expect(r).toBe("Anotei.");
    expect(visto).toEqual({ system: SYSTEM_DA_ORBITA, prompt: "uma tentativa anterior parou\n\nObjetivo: anotar: comprar leite", tools: ["computador_ver", "computador_agir"], maxSteps: 8 });
    expect(SYSTEM_DA_ORBITA).toMatch(/DADO de terceiro/);
    expect(SYSTEM_DA_ORBITA).toMatch(/Nunca digite senha/);
  });

  it("sem nenhuma tool da tela (mãos fora do ar), diz isso em vez de chamar o modelo", async () => {
    let chamou = false;
    const r = await rodarComModeloDaCasa({ objetivo: "x", contexto: "", maxSteps: 3 }, { montarTools: async () => ({ terminal_executar: 1 }), gerar: async () => ((chamou = true), "?") });
    expect(r).toMatch(/Não há ferramentas do computador/);
    expect(chamou).toBe(false);
  });

  it("resposta vazia do modelo vira texto, não vazio", async () => {
    expect(await rodarComModeloDaCasa({ objetivo: "x", contexto: "", maxSteps: 3 }, { montarTools: async () => ({ computador_ver: 1 }), gerar: async () => "" })).toBe("(sem resposta)");
  });
});
