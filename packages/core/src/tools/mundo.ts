/**
 * Informação do mundo lá fora que a Órbita consulta direto (sem raspar busca):
 * cotação de moeda e ação, e rota entre dois lugares. Serviços públicos, sem
 * chave, que responderam nesta máquina em 27/09/2026: AwesomeAPI (moedas e
 * cripto), Yahoo Finance (ações), OpenStreetMap via Photon e Nominatim (endereço) e OSRM
 * (rota). Os endereços são fixos no código, nunca vindos do modelo: não há
 * URL dirigida por LLM aqui.
 */

import { settings } from "../settings";

const UA = { "User-Agent": "OrbitaBot/1.0 (assistente pessoal)" };
/** o teto de espera é config (`web.timeoutMs`), não constante: rede lenta de casa pede mais */
const comTempo = async (url: string, headers: Record<string, string> = UA) =>
  fetch(url, { headers, signal: AbortSignal.timeout((await settings.get("web.timeoutMs").catch(() => 8000)) ?? 8000) });

// ── cotação ──

const MOEDAS: Record<string, string> = {
  dolar: "USD", "dólar": "USD", usd: "USD", euro: "EUR", eur: "EUR", libra: "GBP", gbp: "GBP", iene: "JPY", jpy: "JPY",
  "peso argentino": "ARS", ars: "ARS", "franco suíço": "CHF", chf: "CHF", "dólar canadense": "CAD", cad: "CAD", yuan: "CNY", cny: "CNY",
  bitcoin: "BTC", btc: "BTC", ethereum: "ETH", eth: "ETH",
};

export type Ativo = { tipo: "moeda"; codigo: string } | { tipo: "acao"; ticker: string };

/** "dólar", "EUR", "petr4", "AAPL" → o que consultar. PURA. */
const INDICES: Record<string, string> = { ibovespa: "^BVSP", ibov: "^BVSP", "s&p 500": "^GSPC", "s&p": "^GSPC", nasdaq: "^IXIC", "dow jones": "^DJI" };

export function interpretarAtivo(texto: string): Ativo | null {
  const t = texto.trim().toLowerCase();
  if (!t) return null;
  // hasOwn: "constructor" não é moeda (o objeto herda do protótipo)
  if (Object.hasOwn(MOEDAS, t)) return { tipo: "moeda", codigo: MOEDAS[t] };
  if (Object.hasOwn(INDICES, t)) return { tipo: "acao", ticker: INDICES[t] };
  const par = /^([a-z]{3})[-/ ]?brl$/.exec(t);
  if (par) return { tipo: "moeda", codigo: par[1].toUpperCase() };
  // ticker da B3: 4 letras e 1 ou 2 números (PETR4, BOVA11); ganha o sufixo .SA
  if (/^[a-z]{4}\d{1,2}$/.test(t)) return { tipo: "acao", ticker: t.toUpperCase() + ".SA" };
  // Ticker de fora só em MAIÚSCULAS ("AAPL"): em minúsculas, "gold" virava a
  // ação GOLD (uma mineradora) e a Órbita dava o preço dela como se fosse ouro
  if (texto.trim() === texto.trim().toUpperCase() && /^\^?[a-z.]{1,6}(\.[a-z]{1,3})?$/.test(t)) return { tipo: "acao", ticker: t.toUpperCase() };
  return null;
}

export interface Cotacao {
  ativo: string;
  preco: number;
  moeda: string;
  variacaoPct: number | null;
  quando: string | null;
  fonte: string;
}

export async function cotar(ativo: Ativo): Promise<Cotacao> {
  if (ativo.tipo === "moeda") {
    const par = `${ativo.codigo}-BRL`;
    const j = (await (await comTempo(`https://economia.awesomeapi.com.br/json/last/${par}`)).json()) as Record<string, { bid: string; pctChange: string; create_date: string; name: string }>;
    const v = j[`${ativo.codigo}BRL`];
    if (!v) throw new Error(`Não achei cotação para ${ativo.codigo}.`);
    return { ativo: v.name, preco: Number(v.bid), moeda: "BRL", variacaoPct: Number(v.pctChange), quando: v.create_date, fonte: "AwesomeAPI" };
  }
  const j = (await (await comTempo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ativo.ticker)}?range=1d&interval=1d`, { "User-Agent": "Mozilla/5.0" })).json()) as {
    chart?: { result?: { meta: { regularMarketPrice: number; chartPreviousClose?: number; currency: string; shortName?: string; symbol: string; regularMarketTime?: number } }[] };
  };
  const meta = j.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`Não achei a ação ${ativo.ticker}.`);
  const anterior = meta.chartPreviousClose;
  return {
    // o Yahoo devolve o nome com espaços de alinhamento ("PETROBRAS   PN      N2")
    ativo: `${(meta.shortName ?? meta.symbol).replace(/\s+/g, " ").trim()} (${meta.symbol})`,
    preco: meta.regularMarketPrice,
    moeda: meta.currency,
    variacaoPct: anterior ? ((meta.regularMarketPrice - anterior) / anterior) * 100 : null,
    quando: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    fonte: "Yahoo Finance",
  };
}

// ── rota ──

export interface Lugar {
  nome: string;
  lat: number;
  lon: number;
}

interface FotonItem {
  geometry: { coordinates: [number, number] };
  properties: { countrycode?: string; name?: string; street?: string; housenumber?: string; district?: string; city?: string };
}

/** Resultado do Photon → lugar no Brasil, com um nome legível. PURA. */
export function lerPhoton(features: FotonItem[]): Lugar | null {
  const f = features.find((x) => x.properties.countrycode === "BR");
  if (!f) return null;
  const p = f.properties;
  const rua = [p.street, p.housenumber].filter(Boolean).join(", ");
  const nome = [p.name && p.name !== p.street ? p.name : null, rua || null, p.district, p.city].filter(Boolean).join(", ");
  return { nome: nome || "(sem nome)", lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
}

/**
 * Endereço → posição. Photon primeiro, Nominatim de reserva. Medido em
 * 27/09/2026 com os endereços do dono: o Nominatim não achou "Av. Nossa
 * Senhora do Sabará, 4567" nem com a rua sem número, e achou "Rua Estrela 96"
 * no bairro errado; o Photon (mesmos dados do OpenStreetMap, busca tolerante)
 * achou o prédio pelo número.
 */
/** Endereço já achado: a casa e os lugares salvos não mudam, e cada rota geocodificava tudo de novo. */
const posicoes = new Map<string, { lugar: Lugar; em: number }>();
const POSICAO_VALE_MS = 24 * 3_600_000;

/** Só para testes. */
export function esquecerPosicoes(): void {
  posicoes.clear();
}

export async function geocodificar(endereco: string): Promise<Lugar | null> {
  const chave = endereco.trim().toLowerCase();
  const guardada = posicoes.get(chave);
  if (guardada && Date.now() - guardada.em < POSICAO_VALE_MS) return guardada.lugar;
  const achado = await geocodificarSemCache(endereco);
  if (achado) {
    if (posicoes.size > 500) posicoes.clear();
    posicoes.set(chave, { lugar: achado, em: Date.now() });
  }
  return achado;
}

async function geocodificarSemCache(endereco: string): Promise<Lugar | null> {
  const q = encodeURIComponent(endereco);
  try {
    const j = (await (await comTempo(`https://photon.komoot.io/api/?limit=5&q=${q}`)).json()) as { features?: FotonItem[] };
    const achou = lerPhoton(j.features ?? []);
    if (achou) return achou;
  } catch {
    // Photon fora: tenta o Nominatim
  }
  const j = (await (await comTempo(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&accept-language=pt-BR&q=${q}`)).json()) as { display_name: string; lat: string; lon: string }[];
  const r = j[0];
  return r ? { nome: r.display_name, lat: Number(r.lat), lon: Number(r.lon) } : null;
}

export type Modo = "carro" | "a_pe" | "bicicleta";
const PERFIL: Record<Modo, string> = {
  carro: "https://router.project-osrm.org/route/v1/driving",
  a_pe: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  bicicleta: "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
};

export async function calcularRota(de: Lugar, para: Lugar, modo: Modo): Promise<{ minutos: number; km: number }> {
  const j = (await (await comTempo(`${PERFIL[modo]}/${de.lon},${de.lat};${para.lon},${para.lat}?overview=false`)).json()) as { code: string; routes?: { duration: number; distance: number }[] };
  const r = j.routes?.[0];
  if (j.code !== "Ok" || !r) throw new Error("Não encontrei uma rota entre esses lugares.");
  return { minutos: Math.round(r.duration / 60), km: Math.round(r.distance / 100) / 10 };
}

/**
 * Trânsito de AGORA, pelo TomTom (só com `TOMTOM_API_KEY` no .env; o plano
 * gratuito cobre com folga uma casa). O OSRM não sabe de trânsito: às 7h da
 * manhã em São Paulo ele erra por uma hora. Sem chave, devolve null e quem
 * chama usa o OSRM avisando que é sem trânsito.
 */
export async function rotaComTransito(de: Lugar, para: Lugar): Promise<{ minutos: number; km: number; atrasoMin: number } | null> {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) return null;
  const j = (await (await comTempo(`https://api.tomtom.com/routing/1/calculateRoute/${de.lat},${de.lon}:${para.lat},${para.lon}/json?traffic=true&travelMode=car&key=${encodeURIComponent(key)}`)).json()) as {
    routes?: { summary: { lengthInMeters: number; travelTimeInSeconds: number; trafficDelayInSeconds?: number } }[];
  };
  const s = j.routes?.[0]?.summary;
  if (!s) throw new Error("Não encontrei uma rota entre esses lugares.");
  return { minutos: Math.round(s.travelTimeInSeconds / 60), km: Math.round(s.lengthInMeters / 100) / 10, atrasoMin: Math.round((s.trafficDelayInSeconds ?? 0) / 60) };
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** `b` aparece em `a` como palavras INTEIRAS ("centro" não está em "centro medico" por pedaço, mas está por palavra). */
const temPalavras = (a: string, b: string) => b.length > 0 && ` ${a} `.includes(` ${b} `);

/**
 * "casa", "meu trabalho", "até a Adalink" → o endereço salvo. PURA. Lugares
 * vêm de `casa.lugares` ("Nome: endereço"). O que não for nome salvo volta
 * como veio (é um endereço de verdade).
 *
 * Casa por palavra INTEIRA, nunca por pedaço: "porto" achava "Aeroporto" e
 * "centro" achava "Centro Médico" (medido na auditoria de 27/09/2026). E
 * "casa" sem endereço cadastrado devolve null: ir ao mapa com a palavra "casa"
 * achava um lugar qualquer com esse nome, e a rota saía errada com confiança.
 */
export function resolverLugar(texto: string, casa: string, lugares: string[]): string | null {
  const t = semAcento(texto).replace(/^((a|o|as|os|ao|na|no|pra|pro|para|ate|meu|minha|em|de|do|da)\s+)+/, "");
  if (/^(casa|minha casa)$/.test(t)) return casa.trim() || null;
  const salvos = lugares
    .map((l) => {
      const i = l.indexOf(":");
      return i > 0 ? { nome: semAcento(l.slice(0, i)), endereco: l.slice(i + 1).trim() } : null;
    })
    .filter((l): l is { nome: string; endereco: string } => !!l && !!l.nome && !!l.endereco);
  const exato = salvos.find((l) => l.nome === t);
  if (exato) return exato.endereco;
  // "trabalho da adalink" contém o nome "adalink"; "companhia" é palavra do nome "companhia de estagios"
  const achados = salvos.filter((l) => temPalavras(t, l.nome) || (t.length >= 4 && temPalavras(l.nome, t)));
  return achados.length === 1 ? achados[0].endereco : texto;
}

/** "1 h 5 min" / "25 min". PURA. */
export function duracaoLegivel(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
