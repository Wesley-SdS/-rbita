import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));
let cfg: Record<string, unknown> = {};
vi.mock("../settings", () => ({ settings: { get: async (k: string) => cfg[k], getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])) } }));

import { duracaoLegivel, esquecerPosicoes, interpretarAtivo, lerPhoton, resolverLugar } from "./mundo";
import { lerBingHtml, lerDuckDuckGoHtml, linkDoBing, searchWeb } from "./web";
import { comBuscaNativa } from "../chat/busca-nativa";
import { cotacao, rota } from "./domains/mundo";
import { previsao_tempo } from "./domains/clima";

/**
 * A Órbita na internet (27/09/2026): a pesquisa caía na Wikipédia, o clima
 * pedia a cidade toda vez, e não havia cotação nem rota.
 */

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  cfg = {};
  esquecerPosicoes();
});
const responder = (porUrl: (u: string) => unknown) =>
  (globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
    const r = porUrl(String(u));
    return typeof r === "string" ? new Response(r) : Response.json(r);
  }) as typeof fetch);

describe("pesquisa: leitura das páginas de buscador", () => {
  it("DuckDuckGo HTML: tira o link do redirecionador, pula anúncio", () => {
    const html =
      '<div class="result results_links"><a class="result__a" href="//duckduckgo.com/y.js?ad=1">Anúncio</a></div>' +
      '<div class="result__body"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fanthropic.com%2Fnews&amp;rut=x">Claude <b>Opus</b> 5.5</a><a class="result__snippet" href="#">Lançado &amp; disponível</a></div>';
    expect(lerDuckDuckGoHtml(html, 5)).toEqual([{ titulo: "Claude Opus 5.5", url: "https://anthropic.com/news", trecho: "Lançado & disponível" }]);
  });
  it("Bing HTML", () => {
    const html = '<li class="b_algo"><h2><a href="https://g1.globo.com/x">Dólar <strong>hoje</strong></a></h2><p>Moeda fecha em R$ 5,19</p></li>';
    expect(lerBingHtml(html, 5)).toEqual([{ titulo: "Dólar hoje", url: "https://g1.globo.com/x", trecho: "Moeda fecha em R$ 5,19" }]);
  });
  it("entidades numéricas no título viram o caractere", () => {
    const html = '<li class="b_algo"><h2><a href="https://anthropic.com">Introducing Claude Opus 5.5 &#92; Anthropic &#x2F; x</a></h2></li>';
    expect(lerBingHtml(html, 1)[0].titulo).toBe("Introducing Claude Opus 5.5 \\ Anthropic / x");
  });
  it("cadeia: o primeiro buscador que traz resultado responde; falha pula para o próximo", async () => {
    cfg["web.provedores"] = ["duckduckgo", "bing", "wikipedia"];
    responder((u) => {
      if (u.includes("duckduckgo")) throw new Error("bloqueado");
      if (u.includes("bing")) return '<li class="b_algo"><h2><a href="https://x.com">X</a></h2><p>y</p></li>';
      return {};
    });
    expect(await searchWeb("dólar", 3)).toEqual({ fonte: "bing", resultados: [{ titulo: "X", url: "https://x.com", trecho: "y" }] });
  });
});

describe("busca nativa do Claude", () => {
  const tools = { pesquisar_web: {}, ler_pagina: {} } as never;
  const ligada = { ativa: true, maxUsos: 3 };
  it("com Claude, troca a raspagem pela busca nativa", () => {
    const r = comBuscaNativa(tools, "claude/claude-sonnet-5", ligada)!;
    expect(Object.keys(r).sort()).toEqual(["ler_pagina", "web_search"]);
  });
  it("outro provedor (failover), desligada, ou web fora do turno: fica como está", () => {
    expect(comBuscaNativa(tools, "gateway/gpt-6", ligada)).toBe(tools);
    expect(comBuscaNativa(tools, "claude/claude-sonnet-5", { ...ligada, ativa: false })).toBe(tools);
    const semWeb = { ler_pagina: {} } as never;
    expect(comBuscaNativa(semWeb, "claude/claude-sonnet-5", ligada)).toBe(semWeb);
  });
});

describe("cotação", () => {
  it("entende moeda, par, ação da B3 e ação de fora", () => {
    expect(interpretarAtivo("dólar")).toEqual({ tipo: "moeda", codigo: "USD" });
    expect(interpretarAtivo("eur-brl")).toEqual({ tipo: "moeda", codigo: "EUR" });
    expect(interpretarAtivo("petr4")).toEqual({ tipo: "acao", ticker: "PETR4.SA" });
    expect(interpretarAtivo("AAPL")).toEqual({ tipo: "acao", ticker: "AAPL" });
    expect(interpretarAtivo("quanto está")).toBeNull();
  });
  it("moeda pela AwesomeAPI, com a variação do dia", async () => {
    responder(() => ({ USDBRL: { bid: "5.1866", pctChange: "-0.17", create_date: "2026-09-27 18:00", name: "Dólar Americano/Real Brasileiro" } }));
    expect(await cotacao.run({ ativo: "dólar" }, { userId: "u" })).toBe("Dólar Americano/Real Brasileiro: R$ 5,1866, -0,17% no dia (fonte: AwesomeAPI, 2026-09-27 18:00).");
  });
  it("serviço fora: recado, não erro", async () => {
    responder(() => {
      throw new Error("timeout");
    });
    expect(await cotacao.run({ ativo: "dólar" }, { userId: "u" })).toContain("não respondeu");
  });
});

describe("rota", () => {
  it("sem origem e sem endereço da casa: pede", async () => {
    cfg["casa.endereco"] = "";
    expect(await rota.run({ destino: "Av. Paulista" }, { userId: "u" })).toContain("Não sei o endereço da casa");
  });
  it("de casa até o destino, avisando que é sem trânsito", async () => {
    cfg["casa.endereco"] = "Rua X, 10, São Paulo";
    responder((u) => (u.includes("nominatim") ? [{ display_name: u.includes("Paulista") ? "Av. Paulista" : "Rua X", lat: "-23.5", lon: "-46.6" }] : { code: "Ok", routes: [{ duration: 3900, distance: 12345 }] }));
    const r = String(await rota.run({ destino: "Av. Paulista" }, { userId: "u" }));
    expect(r).toContain("1 h 5 min (12,3 km) de carro, sem contar o trânsito");
  });
  it("com TOMTOM_API_KEY: o tempo com o trânsito de agora", async () => {
    cfg["casa.endereco"] = "Rua X, 10, São Paulo";
    cfg["casa.lugares"] = ["Adalink: Av. Cauaxi, 350, Barueri"];
    process.env.TOMTOM_API_KEY = "k";
    try {
      responder((u) => (u.includes("nominatim") ? [{ display_name: u.includes("Cauaxi") ? "Av. Cauaxi" : "Rua X", lat: "-23.5", lon: "-46.8" }] : { routes: [{ summary: { lengthInMeters: 31200, travelTimeInSeconds: 3000, trafficDelayInSeconds: 900 } }] }));
      const r = String(await rota.run({ destino: "a Adalink" }, { userId: "u" }));
      expect(r).toContain("50 min (31,2 km) de carro com o trânsito de agora, 15 min disso por causa do trânsito");
      expect(r).toContain("Para: Av. Cauaxi");
    } finally {
      delete process.env.TOMTOM_API_KEY;
    }
  });
  it("lugar salvo pelo nome, sem acento e sem artigo; o que não é nome volta como veio", () => {
    const lugares = ["Companhia de Estágios: Rua Estrela, 96, São Paulo", "Adalink: Av. Cauaxi, 350, Barueri", "sem dois pontos"];
    expect(resolverLugar("a Adalink", "Casa 1", lugares)).toBe("Av. Cauaxi, 350, Barueri");
    expect(resolverLugar("companhia de estagios", "Casa 1", lugares)).toBe("Rua Estrela, 96, São Paulo");
    expect(resolverLugar("Companhia", "Casa 1", lugares)).toBe("Rua Estrela, 96, São Paulo");
    expect(resolverLugar("casa", "Casa 1", lugares)).toBe("Casa 1");
    expect(resolverLugar("Av. Paulista, 1000", "Casa 1", lugares)).toBe("Av. Paulista, 1000");
  });
  it("Photon: só o que é do Brasil, com nome, rua e número", () => {
    const foto = (cc: string, props: object) => ({ geometry: { coordinates: [-46.67, -23.69] as [number, number] }, properties: { countrycode: cc, ...props } });
    expect(lerPhoton([foto("PT", { name: "Rua da Estrela" }), foto("BR", { name: "Amarilis", street: "Avenida Nossa Senhora do Sabará", housenumber: "4567", district: "Vila Arriete", city: "São Paulo" })])).toEqual({
      nome: "Amarilis, Avenida Nossa Senhora do Sabará, 4567, Vila Arriete, São Paulo",
      lat: -23.69,
      lon: -46.67,
    });
    expect(lerPhoton([foto("PT", {})])).toBeNull();
  });
  it("Photon fora do ar: o Nominatim responde", async () => {
    cfg["casa.endereco"] = "Rua X, 10, São Paulo";
    responder((u) => {
      if (u.includes("photon")) throw new Error("fora");
      return u.includes("nominatim") ? [{ display_name: "Lugar", lat: "-23.5", lon: "-46.6" }] : { code: "Ok", routes: [{ duration: 600, distance: 5000 }] };
    });
    expect(String(await rota.run({ destino: "Av. Paulista" }, { userId: "u" }))).toContain("10 min (5 km)");
  });
  it("duracaoLegivel", () => {
    expect(duracaoLegivel(25)).toBe("25 min");
    expect(duracaoLegivel(120)).toBe("2 h");
  });
});

describe("clima sem cidade usa a da casa", () => {
  it("sem cidade e sem a da casa: pede para cadastrar", async () => {
    cfg["casa.cidade"] = "";
    expect(await previsao_tempo.run({}, { userId: "u" })).toContain("Não sei a cidade da casa");
  });
});

describe("auditoria de 27/09/2026", () => {
  const lugares = ["Trabalho: Rua Estela, 96, São Paulo", "Aeroporto: Rodovia Hélio Smidt, Guarulhos", "Companhia de Estágios: Rua Estela, 96"];

  it("'casa' sem endereço cadastrado não vai ao mapa como se fosse um lugar", async () => {
    expect(resolverLugar("casa", "", lugares)).toBeNull();
    expect(resolverLugar("minha casa", "", lugares)).toBeNull();
    cfg["casa.endereco"] = "";
    globalThis.fetch = vi.fn() as never;
    expect(String(await rota.run({ origem: "Av. Paulista", destino: "casa" }, { userId: "u" }))).toContain("Não sei o endereço da casa");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("'meu trabalho', 'até o trabalho' e o nome dentro da frase acham o lugar salvo", () => {
    expect(resolverLugar("meu trabalho", "", lugares)).toBe("Rua Estela, 96, São Paulo");
    expect(resolverLugar("até o trabalho", "", lugares)).toBe("Rua Estela, 96, São Paulo");
    expect(resolverLugar("companhia", "", lugares)).toBe("Rua Estela, 96");
  });

  it("pedaço de palavra não sequestra endereço de verdade ('porto' não é o Aeroporto)", () => {
    expect(resolverLugar("porto", "", lugares)).toBe("porto");
  });

  it("cotação: índice brasileiro, e minúscula não vira ticker de fora", () => {
    expect(interpretarAtivo("ibovespa")).toEqual({ tipo: "acao", ticker: "^BVSP" });
    expect(interpretarAtivo("gold")).toBeNull();
    expect(interpretarAtivo("constructor")).toBeNull();
    expect(interpretarAtivo("GOLD")).toEqual({ tipo: "acao", ticker: "GOLD" });
  });

  it("Bing: o link de rastreio vira o endereço de verdade", () => {
    const destino = "https://g1.globo.com/economia/";
    const rastreio = `https://www.bing.com/ck/a?!&&p=abc&u=a1${Buffer.from(destino).toString("base64url")}&ntb=1`;
    expect(linkDoBing(rastreio)).toBe(destino);
    expect(linkDoBing("https://x.com/y")).toBe("https://x.com/y");
  });

  it("entidade inválida não derruba a página; '<path' do SVG não vira trecho", () => {
    const html = '<li class="b_algo"><svg><path d="M0"/></svg><h2><a href="https://x.com">Preço &#99999999; hoje</a></h2><p>Texto certo</p></li>';
    expect(lerBingHtml(html, 1)).toEqual([{ titulo: "Preço &#99999999; hoje", url: "https://x.com", trecho: "Texto certo" }]);
  });

  it("buscador com nome errado vai para o log e, sem nenhum válido, vale a ordem padrão", async () => {
    cfg["web.provedores"] = ["duckduck"];
    responder((u) => (u.includes("bing") ? '<li class="b_algo"><h2><a href="https://x.com">X</a></h2></li>' : u.includes("wikipedia") ? {} : "<html></html>"));
    expect((await searchWeb("dólar", 3)).fonte).toBe("bing");
  });

  it("TomTom falhando cai no OSRM, sem trânsito", async () => {
    cfg["casa.endereco"] = "Rua X, 10, São Paulo";
    process.env.TOMTOM_API_KEY = "k";
    try {
      responder((u) => {
        if (u.includes("tomtom")) throw new Error("403");
        return u.includes("photon") ? { features: [{ geometry: { coordinates: [-46.6, -23.5] }, properties: { countrycode: "BR", name: "Lugar" } }] } : { code: "Ok", routes: [{ duration: 600, distance: 5000 }] };
      });
      expect(String(await rota.run({ destino: "Av. Paulista" }, { userId: "u" }))).toContain("sem contar o trânsito");
    } finally {
      delete process.env.TOMTOM_API_KEY;
    }
  });
});
