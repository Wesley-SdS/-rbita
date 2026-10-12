import { settings } from "../settings";
import { embrulharDadoExterno } from "../texto/dado-externo";
import { chamarMaos, MaosError } from "../maos/client";
import { sessaoParaTipo } from "../controle/sessao";
import type { ElementoVisto } from "./risco";

/**
 * O Windows entre as tools e o apps/maos (PRD A6, A7): ler janelas e a árvore,
 * descrever o que está num ponto, e mandar UMA ordem já conferida.
 *
 * Os apps ocultos vão em todo pedido (a lista da tela), e as mãos ainda somam
 * a lista que o laço `maos` empurrou: pintar de preto e tirar da árvore
 * acontecem LÁ, antes de qualquer byte sair. Título de janela, nome de botão e
 * texto de campo são conteúdo de terceiro: voltam embrulhados como dado.
 */

export async function ocultosDaConfig(): Promise<string[]> {
  return settings.get("computador.appsOcultos").catch(() => [] as string[]);
}

/** "1280x720" → [1280, 720]; torto, o padrão da Anthropic. Puro. */
export function resolucaoDaConfig(s: string | null | undefined): [number, number] {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec((s ?? "").trim());
  return m ? [Number(m[1]), Number(m[2])] : [1280, 720];
}

export interface JanelaDasMaos {
  janela: number;
  titulo: string;
  app: string;
  exe: string;
  nomes: string[];
  pid: number;
  foco: boolean;
  minimizada: boolean;
  monitor: number | null;
  retangulo: number[];
  elevada: boolean;
  oculta: boolean;
}

export interface ElementoDaArvore {
  id: number;
  papel: string;
  nome: string;
  retangulo: number[];
  valor?: string;
  estado?: string[];
}

export interface CapturaDasMaos {
  captura: string;
  monitor: number;
  largura: number;
  altura: number;
  escala: number;
  origem: [number, number];
  mediaType: "image/png" | "image/jpeg";
  base64: string;
  miniatura: string;
  ocultas_pintadas: number;
  marcas: Record<string, [number, number]> | null;
  ms: number;
  bytes: number;
}

export interface LeituraDaJanela {
  leitura: string;
  janela: JanelaDasMaos;
  elementos: ElementoDaArvore[];
  total_na_arvore: number;
  uteis: number;
  cortados: number;
  ms: number;
  imagem?: CapturaDasMaos;
}

export async function janelasAbertas(): Promise<JanelaDasMaos[]> {
  const r = await chamarMaos<{ janelas: JanelaDasMaos[] }>("/computador/janelas", { corpo: { ocultos: await ocultosDaConfig() } });
  return r.janelas;
}

/** As janelas em texto, embrulhado (o título é escolhido pelo conteúdo). Puro. */
export function janelasEmTexto(js: readonly JanelaDasMaos[]): string {
  const linhas = js.map(
    (j) =>
      `janela ${j.janela} · ${j.app || j.exe}${j.titulo ? ` · "${j.titulo}"` : ""}${j.foco ? " · em foco" : ""}${j.minimizada ? " · minimizada" : ""}${j.monitor !== null ? ` · monitor ${j.monitor}` : ""}${j.elevada ? " · administrador (a Órbita não age nela)" : ""}${j.oculta ? " · oculta" : ""}`,
  );
  return embrulharDadoExterno("tela", linhas.join("\n") || "(nenhuma janela aberta)");
}

/** A árvore em texto: uma linha por elemento, com o número que o agir usa. Puro. */
export function arvoreEmTexto(els: readonly ElementoDaArvore[], cortados: number): string {
  const linhas = els.map((e) => `[${e.id}] ${e.papel}${e.nome ? ` "${e.nome}"` : ""}${e.valor ? ` = "${e.valor}"` : ""}${e.estado?.length ? ` (${e.estado.join(", ")})` : ""}`);
  if (cortados > 0) linhas.push(`(mais ${cortados} elementos cortados pelo teto; peça uma janela menor ou a captura)`);
  return embrulharDadoExterno("tela", linhas.join("\n") || "(a janela não expôs elementos de acessibilidade; use a captura)");
}

export interface PedidoDeVer {
  janela?: number | null;
  comImagem?: boolean;
  monitor?: number | null;
  marcas?: "grade" | "elementos" | null;
}

export async function lerJanela(p: PedidoDeVer): Promise<LeituraDaJanela> {
  const c = await settings.getMany(["computador.elementosMax", "computador.resolucaoCaptura"]);
  return chamarMaos<LeituraDaJanela>("/computador/ver", {
    corpo: {
      janela: p.janela ?? null,
      elementosMax: c["computador.elementosMax"],
      comImagem: p.comImagem === true,
      resolucao: resolucaoDaConfig(c["computador.resolucaoCaptura"]),
      monitor: p.monitor ?? null,
      marcas: p.marcas ?? null,
      formato: "jpeg",
      ocultos: await ocultosDaConfig(),
    },
    // UIA de um app grande (VS Code) mais a captura: passa dos 10 s padrão
    timeoutMs: 40_000,
  });
}

/** Só a captura (monitor ou janela), sem árvore: é o que o laço do Claude pede a cada passo. */
export interface RegiaoDaCaptura {
  captura: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A resolução reduzida por um fator (0,25 a 1): a tarefa delegada usa quando a API recusa a imagem por tamanho. Puro. */
export function resolucaoReduzida(base: [number, number], fator: number | null | undefined): [number, number] {
  const f = !fator || !(fator > 0) ? 1 : Math.min(1, Math.max(0.25, fator));
  return [Math.max(160, Math.round(base[0] * f)), Math.max(90, Math.round(base[1] * f))];
}

export async function capturarTela(p: { janela?: number | null; monitor?: number | null; formato?: "jpeg" | "png"; marcas?: "grade" | null; regiao?: RegiaoDaCaptura | null; fator?: number | null } = {}): Promise<CapturaDasMaos> {
  const res = await settings.get("computador.resolucaoCaptura").catch(() => "1280x720");
  return chamarMaos<CapturaDasMaos>("/computador/capturar", {
    corpo: { janela: p.janela ?? null, monitor: p.monitor ?? null, resolucao: resolucaoReduzida(resolucaoDaConfig(res), p.fator), formato: p.formato ?? "jpeg", marcas: p.marcas ?? null, regiao: p.regiao ?? null, ocultos: await ocultosDaConfig() },
    timeoutMs: 20_000,
  });
}

// ── o alvo ──────────────────────────────────────────────────────────────────

/** Como o modelo aponta o alvo: o número da leitura, ou um ponto (ou marca) da captura. */
export interface AlvoPedido {
  leitura?: string | null;
  elemento?: number | null;
  captura?: string | null;
  x?: number | null;
  y?: number | null;
  marca?: number | null;
}

interface DescricaoDasMaos {
  papel: string;
  nome: string;
  assinatura: string;
  senha: boolean;
  app: string;
  nomes_do_app: string[];
  oculto: boolean;
  elevado: boolean;
  janela: number;
  ponto?: [number, number] | null;
  retangulo?: number[];
}

export function vistoDasMaos(d: DescricaoDasMaos): ElementoVisto {
  const ponto: [number, number] | null = Array.isArray(d.ponto) ? [Math.round(d.ponto[0]), Math.round(d.ponto[1])] : Array.isArray(d.retangulo) && d.retangulo.length === 4 ? [Math.round((d.retangulo[0]! + d.retangulo[2]!) / 2), Math.round((d.retangulo[1]! + d.retangulo[3]!) / 2)] : null;
  return {
    papel: String(d.papel ?? "outro").slice(0, 40),
    nome: String(d.nome ?? "").slice(0, 200),
    assinatura: String(d.assinatura ?? ""),
    senha: d.senha === true,
    app: String(d.app ?? "").slice(0, 120),
    nomesDoApp: Array.isArray(d.nomes_do_app) ? d.nomes_do_app.map(String).slice(0, 20) : [],
    oculto: d.oculto === true,
    elevado: d.elevado === true,
    janela: Number(d.janela) || 0,
    ponto,
  };
}

export function temAlvo(a: AlvoPedido | null | undefined): boolean {
  return !!a && ((!!a.leitura && a.elemento != null) || (!!a.captura && (a.marca != null || (a.x != null && a.y != null))));
}

/** O que está no alvo AGORA, segundo a árvore de acessibilidade. */
export async function descreverAlvo(a: AlvoPedido): Promise<ElementoVisto> {
  const ocultos = await ocultosDaConfig();
  if (a.leitura && a.elemento != null) return vistoDasMaos(await chamarMaos<DescricaoDasMaos>("/computador/elemento", { corpo: { leitura: a.leitura, elemento: a.elemento, ocultos } }));
  if (a.captura && a.marca != null) return vistoDasMaos(await chamarMaos<DescricaoDasMaos>("/computador/no-ponto", { corpo: { captura: a.captura, marca: a.marca, ocultos } }));
  if (a.captura && a.x != null && a.y != null) return vistoDasMaos(await chamarMaos<DescricaoDasMaos>("/computador/no-ponto", { corpo: { captura: a.captura, x: a.x, y: a.y, ocultos } }));
  throw new MaosError("Diga o alvo: { leitura, elemento } de computador_ver, ou { captura, x, y } da imagem.", 422, true);
}

/** O elemento com o foco agora (para digitar e tecla sem alvo), ou null. */
export async function descreverFocado(): Promise<ElementoVisto | null> {
  try {
    return vistoDasMaos(await chamarMaos<DescricaoDasMaos>("/computador/focado", { corpo: { ocultos: await ocultosDaConfig() } }));
  } catch (e) {
    if (e instanceof MaosError && e.status === 404) return null;
    throw e;
  }
}

/** Os nomes pelos quais um app casa com o envelope, pela tabela de apelidos das mãos. */
export async function nomesDoApp(nome: string): Promise<string[]> {
  const r = await chamarMaos<{ nomes: string[] }>(`/apps/nomes?nome=${encodeURIComponent(nome.slice(0, 120))}`).catch(() => ({ nomes: [nome] }));
  return r.nomes.length ? r.nomes : [nome];
}

export async function sessaoDoComputador(userId: string) {
  return sessaoParaTipo(userId, "computador");
}

/** A frase de erro das mãos para o modelo (recusa vem pronta; o resto, resumido). */
export function mensagemDasMaos(e: unknown): string {
  if (e instanceof MaosError) return e.message;
  return `As mãos do Windows não conseguiram: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
}
