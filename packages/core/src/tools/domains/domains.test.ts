import { describe, it, expect, vi, afterEach } from "vitest";
import { hora_atual } from "./tempo";
import { previsao_tempo } from "./clima";
import { pesquisar_web, ler_pagina } from "./web-tools";
import { enviar_whatsapp } from "./whatsapp";
import { enviar_email, criar_evento } from "./google";
import { enviar_slack } from "./slack";
import { needsApproval } from "../registry";

/**
 * Teste de execução por tool (TL.7), com a dependência simulada. As tools que
 * dependem do banco são cobertas pelo registro (gate) e pela paridade do chat;
 * aqui ficam as puras e as de rede (fetch simulado).
 */
const ctx = { userId: "u1" };

afterEach(() => vi.restoreAllMocks());

describe("tempo", () => {
  it("hora_atual devolve a data em pt-BR", async () => {
    const r = (await hora_atual.run({}, ctx)) as { agora: string };
    expect(r.agora).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

describe("clima", () => {
  it("previsao_tempo monta a previsão a partir do Open-Meteo", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("geocoding")) return new Response(JSON.stringify({ results: [{ latitude: -23.5, longitude: -46.6, name: "São Paulo", country: "Brasil" }] }));
      return new Response(JSON.stringify({
        current: { temperature_2m: 21, apparent_temperature: 20, weather_code: 0, wind_speed_10m: 5 },
        daily: { temperature_2m_min: [15], temperature_2m_max: [26], precipitation_sum: [0] },
      }));
    });
    const r = (await previsao_tempo.run({ cidade: "São Paulo" }, ctx)) as { cidade: string; agora: { temperatura: number } | null; hoje: { max: number } | null };
    expect(r.cidade).toBe("São Paulo, Brasil");
    expect(r.agora?.temperatura).toBe(21);
    expect(r.hoje?.max).toBe(26);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("previsao_tempo: cidade desconhecida devolve erro, não lança", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    const r = (await previsao_tempo.run({ cidade: "Lugar Nenhum" }, ctx)) as { erro?: string };
    expect(r.erro).toMatch(/não encontrada/);
  });
});

describe("web", () => {
  it("ler_pagina recusa URL de rede interna (defesa SSRF) com mensagem amigável, sem lançar", async () => {
    const r = (await ler_pagina.run({ url: "http://127.0.0.1:8080/admin" }, ctx)) as { conteudo: string };
    expect(r.conteudo).toMatch(/Não posso acessar/);
  });
  it("pesquisar_web é de leitura e valida a entrada", () => {
    expect(pesquisar_web.risk).toBe("leitura");
    expect(pesquisar_web.inputSchema.safeParse({}).success).toBe(false);
    expect(pesquisar_web.inputSchema.safeParse({ consulta: "x" }).success).toBe(true);
  });
});

describe("tools com efeito externo", () => {
  it("as quatro que enfileiravam antes continuam exigindo aprovação (paridade do gate)", () => {
    for (const t of [enviar_email, criar_evento, enviar_slack, enviar_whatsapp]) {
      expect(needsApproval(t.risk), t.name).toBe(true);
      expect(typeof t.summarize).toBe("function");
    }
    expect(enviar_email.summarize!({ para: "a@b.c", assunto: "Oi", corpo: "" })).toBe('Enviar e-mail para a@b.c: "Oi"');
    expect(criar_evento.summarize!({ titulo: "Reunião", inicio: "2026-09-17T10:00:00-03:00", fim: "" })).toMatch(/Criar evento "Reunião"/);
  });
  it("enviar_whatsapp só fica disponível com o token do app configurado", () => {
    expect(enviar_whatsapp.requires?.available?.()).toBe(false);
  });
});
