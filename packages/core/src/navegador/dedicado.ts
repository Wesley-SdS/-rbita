import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Frame, Page } from "playwright-core";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { registrarEspelho, type EnvelopeEspelhado, type EventoDoEspelho } from "../controle/espelho";
import { urlNaLista, urlRecusadaPelasMaos } from "./categorias";
import { capturarAba, executarAgir, RecusaDasMaos, type MaosDaAba } from "./executor";
import { orbitaNaPagina, type PedidoNaPagina, type RespostaNaPagina } from "./pagina";
import type { AbaVista, Ordem, RegraDeSitesDaExtensao, ResultadoDaOrdem } from "./protocolo";

/**
 * PERFIL DEDICADO (PRD B6): um Chrome separado, com pasta própria ("Órbita"),
 * para o que roda SEM o dono olhando (rotina da madrugada, regra). Os cookies do
 * perfil real nunca estão aqui: o dono faz login neste perfil só nos sites que
 * a Órbita pode usar sozinha (botão "Abrir para fazer login" na tela).
 *
 * Controlado pelo Playwright com `launchPersistentContext`, que conecta pelo
 * `--remote-debugging-pipe` (nenhuma porta TCP aberta: uma página web não
 * alcança o depurador). Usa o Chrome instalado (`executablePath`), sem baixar
 * navegador nenhum. O Chrome 136+ só ignora o depurador no perfil PADRÃO; com
 * `--user-data-dir` próprio ele funciona.
 *
 * As travas são as mesmas da extensão: as categorias bloqueadas e o modo dos
 * sites (repetidos aqui, do lado das mãos), a máscara de senha e cartão na
 * página e a assinatura do alvo conferida na hora de agir. O que ele não tem
 * é o mundo isolado da extensão: o `page.evaluate` roda no mundo da página, e
 * uma página hostil poderia mexer no mapa de refs dela mesma (nunca no de outra
 * aba, nem fora do navegador). Por isso o perfil dedicado só faz o que rotina
 * pode: ler, e agir com a mesma sessão e fila de sempre.
 *
 * O CONTRATO DAS MÃOS vale aqui igual à extensão (I-10 da auditoria): o
 * dedicado é um espelho registrado (`ligarEspelhoDoDedicado`), recusa `agir`
 * sem um envelope ativo e dentro do prazo (ou aprovado na fila), recusa tudo
 * que mexe depois do Parar, e o Parar FECHA o Chrome dedicado (é o "soltar o
 * depurador" daqui). Cada `page.evaluate` tem prazo: um laço infinito na
 * página travava a rotina para sempre; agora a aba é fechada e a ordem falha.
 */

const CHROMES_CONHECIDOS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
];

export interface OpcoesDoDedicado {
  /** caminho do chrome.exe; vazio usa `navegador.dedicadoChrome` ou o instalado */
  executavel?: string;
  /** pasta do perfil; vazio usa `navegador.dedicadoPasta` ou AppData */
  pasta?: string;
  visivel?: boolean;
}

export function chromeDoDedicado(configurado: string): string | null {
  const lista = [configurado, process.env.ORBITA_CHROME_DEDICADO ?? "", ...CHROMES_CONHECIDOS].filter(Boolean);
  return lista.find((c) => existsSync(c)) ?? null;
}

export function pastaDoDedicado(configurada: string): string {
  return configurada || join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Orbita", "chrome-dedicado");
}

let contexto: BrowserContext | null = null;
let abrindo: Promise<BrowserContext> | null = null;
let visivelAgora = false;
let ociosoRelogio: ReturnType<typeof setTimeout> | null = null;
const idDaPagina = new WeakMap<Page, number>();
const cdpDaPagina = new WeakMap<Page, CDPSession>();
let proximoId = 1;
let ativa: Page | null = null;
let opcoesFixas: OpcoesDoDedicado | null = null;
const escalaDaPagina = new WeakMap<Page, number>();

// ── o espelho do envelope, do lado do dedicado (o mesmo contrato da extensão) ──
const envelopes = new Map<string, EnvelopeEspelhado>();
const parados = new Set<string>();
const passosLocais = new Map<string, number>();
let espelhoLigado = false;

async function notificarDedicado(e: EventoDoEspelho): Promise<void> {
  if (e.tipo === "envelope") {
    if (e.envelope.alvo === "computador") return;
    envelopes.set(e.userId, e.envelope);
    parados.delete(e.userId);
    passosLocais.set(e.userId, 0);
  } else if (e.tipo === "fim") {
    if (envelopes.get(e.userId)?.sessaoId === e.sessaoId) envelopes.delete(e.userId);
  } else {
    envelopes.delete(e.userId);
    parados.add(e.userId);
    // o Parar do dedicado é fechar o Chrome dele: nada continua rodando lá
    await fecharDedicado("parar");
  }
}

/** Registra o dedicado como espelho do envelope (o boot do api chama). Idempotente. */
export function ligarEspelhoDoDedicado(): void {
  if (espelhoLigado) return;
  espelhoLigado = true;
  registrarEspelho({ nome: "dedicado", notificar: notificarDedicado });
}

/** O envelope do dono vale agora? Ativo, dentro do prazo e abaixo do teto de passos (contados aqui também). */
function envelopeValido(userId: string | undefined): EnvelopeEspelhado | null {
  if (!userId) return null;
  const e = envelopes.get(userId);
  if (!e || parados.has(userId)) return null;
  if (!(Date.parse(e.expiraEm) > Date.now())) return null;
  if (e.passosUsados + (passosLocais.get(userId) ?? 0) >= e.tetoPassos) return null;
  return e;
}

/** Só para testes. */
export function _limparEspelhoDoDedicado(): void {
  envelopes.clear();
  parados.clear();
  passosLocais.clear();
  espelhoLigado = false;
}

/** Só para testes: fixa o Chrome e a pasta sem passar pela config. */
export function _fixarOpcoesDoDedicado(o: OpcoesDoDedicado | null): void {
  opcoesFixas = o;
}

async function resolverOpcoes(o: OpcoesDoDedicado = {}): Promise<Required<OpcoesDoDedicado>> {
  const base = { ...opcoesFixas, ...o };
  const cfg = await settings.getMany(["navegador.dedicadoChrome", "navegador.dedicadoPasta", "navegador.dedicadoVisivel"]);
  const executavel = base.executavel || chromeDoDedicado(cfg["navegador.dedicadoChrome"]);
  if (!executavel) throw new RecusaDasMaos("Não achei o Chrome para o perfil dedicado. Diga o caminho em Ajustes (Chrome do perfil dedicado).", "sem_chrome");
  return { executavel, pasta: base.pasta || pastaDoDedicado(cfg["navegador.dedicadoPasta"]), visivel: base.visivel ?? cfg["navegador.dedicadoVisivel"] };
}

function idDe(p: Page): number {
  let id = idDaPagina.get(p);
  if (!id) {
    id = proximoId++;
    idDaPagina.set(p, id);
  }
  return id;
}

async function adiarOcioso(): Promise<void> {
  if (ociosoRelogio) clearTimeout(ociosoRelogio);
  const min = await settings.get("navegador.dedicadoOciosoMin").catch(() => 5);
  ociosoRelogio = setTimeout(() => void fecharDedicado("ocioso"), min * 60_000);
  ociosoRelogio.unref?.();
}

export async function abrirDedicado(o: OpcoesDoDedicado = {}): Promise<BrowserContext> {
  if (contexto && (o.visivel === undefined || o.visivel === visivelAgora)) return contexto;
  if (contexto) await fecharDedicado("trocar a janela");
  if (abrindo) return abrindo;
  abrindo = (async () => {
    const op = await resolverOpcoes(o);
    mkdirSync(op.pasta, { recursive: true });
    const { chromium } = await import("playwright-core");
    const ctx = await chromium.launchPersistentContext(op.pasta, {
      executablePath: op.executavel,
      headless: !op.visivel,
      viewport: { width: 1280, height: 800 },
      // sem a flag de automação o Chrome não mostra a faixa "controlado por software de teste";
      // aqui ela FICA, como no perfil real (decisão do dono): é o aviso de que algo está no controle
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    visivelAgora = op.visivel;
    ctx.on("close", () => {
      if (contexto === ctx) contexto = null;
    });
    log.info("navegador.dedicado_aberto", { visivel: op.visivel });
    return ctx;
  })();
  try {
    contexto = await abrindo;
    return contexto;
  } finally {
    abrindo = null;
  }
}

export async function fecharDedicado(motivo: string): Promise<void> {
  const c = contexto;
  contexto = null;
  ativa = null;
  if (ociosoRelogio) clearTimeout(ociosoRelogio);
  if (c) {
    await c.close().catch(() => undefined);
    log.info("navegador.dedicado_fechado", { motivo });
  }
}

export function dedicadoAberto(): boolean {
  return contexto !== null;
}

/**
 * Apaga o perfil dedicado inteiro (cookies, logins, histórico): fecha o Chrome
 * dele e remove a pasta. A tela chama pelo botão, e o apagar conta do dono
 * também (os logins da casa não ficam para trás num disco).
 */
export async function apagarPerfilDedicado(motivo: string): Promise<{ pasta: string; apagada: boolean }> {
  await fecharDedicado(motivo);
  const pasta = opcoesFixas?.pasta || pastaDoDedicado(await settings.get("navegador.dedicadoPasta").catch(() => ""));
  if (!existsSync(pasta)) return { pasta, apagada: false };
  // o Chrome pode levar um instante para soltar os arquivos depois de fechar
  rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  log.info("navegador.dedicado_apagado", { motivo });
  return { pasta, apagada: !existsSync(pasta) };
}

async function cdpDe(p: Page): Promise<CDPSession> {
  let s = cdpDaPagina.get(p);
  if (!s) {
    s = await p.context().newCDPSession(p);
    cdpDaPagina.set(p, s);
  }
  return s;
}

/**
 * O `tsx` (e o esbuild com `keepNames`) põe `__name(...)` dentro das funções
 * para guardar o nome delas; serializada para a página, a função chamaria um
 * `__name` que lá não existe. O calço devolve a própria função.
 */
const CALCO = "globalThis.__name = globalThis.__name || ((f) => f);";

/**
 * `evaluate` com prazo. Uma página com laço infinito segura o `evaluate` para
 * sempre (e a rotina junto); estourou, a aba é FECHADA (é o único jeito de
 * matar o laço da página) e a ordem falha com o motivo.
 */
async function avaliarComPrazo(p: Page, alvo: Page | Frame, pedido: PedidoNaPagina, prazoMs: number): Promise<RespostaNaPagina> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rej) => {
    relogio = setTimeout(() => rej(new RecusaDasMaos(`A página não respondeu em ${Math.round(prazoMs / 1000)} s: fechei a aba.`, "sem_resposta")), prazoMs);
  });
  try {
    return await Promise.race([
      (async () => {
        await alvo.evaluate(CALCO);
        return (await alvo.evaluate(orbitaNaPagina, pedido)) as RespostaNaPagina;
      })(),
      prazo,
    ]);
  } catch (e) {
    if (e instanceof RecusaDasMaos && e.codigo === "sem_resposta") await p.close({ runBeforeUnload: false }).catch(() => undefined);
    throw e;
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

function maosDaPagina(p: Page, prazoMs: number): MaosDaAba {
  return {
    cdp: async (metodo, params) => (await cdpDe(p)).send(metodo as never, params as never),
    pagina: (pedido: PedidoNaPagina) => avaliarComPrazo(p, p, pedido, prazoMs),
    // a máscara da captura vale em todos os quadros (o cartão em iframe de pagamento também)
    paginaEmTodosOsQuadros: (pedido: PedidoNaPagina) => Promise.all(p.frames().map((f) => avaliarComPrazo(p, f, pedido, prazoMs))),
  };
}

function paginas(ctx: BrowserContext): Page[] {
  return ctx.pages().filter((p) => !p.isClosed());
}

function paginaDe(ctx: BrowserContext, aba?: number | null): Page {
  const lista = paginas(ctx);
  if (aba) {
    const p = lista.find((x) => idDe(x) === aba);
    if (!p) throw new RecusaDasMaos(`A aba ${aba} não existe no perfil dedicado.`, "sem_aba");
    return p;
  }
  if (ativa && !ativa.isClosed()) return ativa;
  const p = lista[lista.length - 1];
  if (!p) throw new RecusaDasMaos("Não há aba aberta no perfil dedicado.", "sem_aba");
  return p;
}

function conferirUrl(url: string, sites: RegraDeSitesDaExtensao): void {
  if (urlRecusadaPelasMaos(url, sites)) throw new RecusaDasMaos("Site bloqueado para a Órbita.", "bloqueado");
}

interface CfgDoDedicado {
  agindoMs: number;
  timeoutMs: number;
  /** o dono da ordem: é o envelope DELE que vale para agir */
  userId?: string;
}

/** Ordem que MEXE (abre, navega, fecha, age): depois do Parar, nenhuma passa. */
const MEXE = new Set(["agir", "abrir", "historico", "fechar", "focar"]);

/** Uma ordem no perfil dedicado, com as mesmas travas da extensão. */
export async function ordemAoDedicado(ordem: Ordem, sites: RegraDeSitesDaExtensao, cfg: CfgDoDedicado): Promise<ResultadoDaOrdem> {
  if (cfg.userId && parados.has(cfg.userId) && MEXE.has(ordem.tipo)) throw new RecusaDasMaos("O dono apertou Parar: o perfil dedicado não mexe em nada até uma sessão nova.", "parado");
  // agir só dentro de um envelope que vale agora (ativo, no prazo, abaixo do teto)
  if (ordem.tipo === "agir" && !envelopeValido(cfg.userId)) throw new RecusaDasMaos("Sem uma sessão de controle ativa (ou ela venceu, ou chegou ao teto): o perfil dedicado não age.", "sem_sessao");
  // site bloqueado é a recusa mais forte (e a mais clara): vem antes da pergunta sobre o envelope
  if (ordem.tipo === "abrir") conferirUrl(ordem.url, sites);
  if (ordem.tipo === "abrir" && !ordem.paraLer && !ordem.aprovada && ordem.url !== "about:blank") {
    const env = envelopeValido(cfg.userId);
    if (!env || !(urlNaLista(ordem.url, env.sites) || urlNaLista(ordem.url, sites.escrita))) throw new RecusaDasMaos("Esse site não está no envelope da sessão.", "fora_do_envelope");
  }
  const ctx = await abrirDedicado();
  await adiarOcioso();
  const inicio = Date.now();
  const r = await executar(ctx, ordem, sites, cfg);
  return { ...r, ms: Date.now() - inicio };
}

async function executar(ctx: BrowserContext, ordem: Ordem, sites: RegraDeSitesDaExtensao, cfg: CfgDoDedicado): Promise<ResultadoDaOrdem> {
  switch (ordem.tipo) {
    case "abas": {
      const atual = ativa && !ativa.isClosed() ? ativa : paginas(ctx).at(-1);
      const abas: AbaVista[] = await Promise.all(
        paginas(ctx).map(async (p) => {
          const url = p.url();
          const bloqueada = urlRecusadaPelasMaos(url, sites);
          return { aba: idDe(p), titulo: bloqueada ? "" : await p.title().catch(() => ""), url: bloqueada ? "" : url.split("#")[0]!, ativa: p === atual, noGrupo: true, ...(bloqueada ? { bloqueada: true } : {}) };
        }),
      );
      return { abas };
    }
    case "abrir": {
      conferirUrl(ordem.url, sites);
      const p = ordem.nova || !paginas(ctx).length ? await ctx.newPage() : paginaDe(ctx, ordem.aba);
      ativa = p;
      if (ordem.url !== "about:blank") await p.goto(ordem.url, { waitUntil: "domcontentloaded", timeout: cfg.timeoutMs });
      const final = p.url();
      // redirecionamento para site bloqueado: a aba não fica lá
      if (urlRecusadaPelasMaos(final, sites)) {
        await p.goto("about:blank").catch(() => undefined);
        throw new RecusaDasMaos("O site redirecionou para um endereço bloqueado.", "bloqueado");
      }
      return { aba: idDe(p), url: final.split("#")[0], titulo: await p.title().catch(() => "") };
    }
    case "historico": {
      const p = paginaDe(ctx, ordem.aba);
      if (ordem.direcao === "voltar") await p.goBack({ waitUntil: "domcontentloaded", timeout: cfg.timeoutMs });
      else if (ordem.direcao === "avancar") await p.goForward({ waitUntil: "domcontentloaded", timeout: cfg.timeoutMs });
      else await p.reload({ waitUntil: "domcontentloaded", timeout: cfg.timeoutMs });
      conferirUrl(p.url(), sites);
      return { aba: idDe(p), url: p.url().split("#")[0], titulo: await p.title().catch(() => "") };
    }
    case "fechar": {
      await paginaDe(ctx, ordem.aba).close();
      return { feito: "Aba fechada." };
    }
    case "focar": {
      ativa = paginaDe(ctx, ordem.aba);
      await ativa.bringToFront().catch(() => undefined);
      return { aba: idDe(ativa), url: ativa.url().split("#")[0], titulo: await ativa.title().catch(() => "") };
    }
    default:
      break;
  }

  const p = paginaDe(ctx, "aba" in ordem ? ordem.aba : null);
  conferirUrl(p.url(), sites);
  const maos = maosDaPagina(p, cfg.timeoutMs);
  switch (ordem.tipo) {
    case "ler": {
      const r = await maos.pagina({ tipo: "ler", modo: ordem.modo, filtro: ordem.filtro, maxElementos: ordem.maxElementos, maxCaracteres: ordem.maxCaracteres, ref: ordem.ref ?? null });
      if (!r.ok) throw new RecusaDasMaos(r.erro, r.codigo);
      return { aba: idDe(p), ...("leitura" in r ? { leitura: r.leitura } : {}) };
    }
    case "ver": {
      const img = await capturarAba(maos, { larguraMax: ordem.larguraMax, regiao: ordem.regiao ?? null, escalaAnterior: escalaDaPagina.get(p), miniatura: !!ordem.miniatura });
      if (!ordem.regiao) escalaDaPagina.set(p, img.escala);
      return { aba: idDe(p), imagem: img, url: p.url().split("#")[0] };
    }
    case "descrever":
    case "achar":
    case "focado": {
      const r = await maos.pagina(
        ordem.tipo === "focado" ? { tipo: "focado" } : ordem.tipo === "achar" ? { tipo: "achar", papel: ordem.papel, nome: ordem.nome, texto: ordem.texto, seletor: ordem.seletor } : { tipo: "descrever", ref: ordem.ref ?? null, x: ordem.x ?? null, y: ordem.y ?? null },
      );
      if (!r.ok) throw new RecusaDasMaos(r.erro, r.codigo);
      return { aba: idDe(p), url: p.url().split("#")[0], alvo: "alvo" in r ? r.alvo : "focado" in r ? r.focado : null };
    }
    case "agir": {
      const env = envelopeValido(cfg.userId);
      if (!ordem.aprovada && !(env && (urlNaLista(p.url(), env.sites) || urlNaLista(p.url(), sites.escrita)))) throw new RecusaDasMaos("Esse site não está no envelope da sessão.", "fora_do_envelope");
      if (cfg.userId) passosLocais.set(cfg.userId, (passosLocais.get(cfg.userId) ?? 0) + 1);
      const r = await executarAgir(maos, ordem, { agindoMs: cfg.agindoMs, urlAtual: p.url() });
      // a ação pode ter levado a página para fora: o resultado diz para onde
      await p.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);
      return { ...r, aba: idDe(p), url: p.url().split("#")[0] };
    }
  }
  throw new RecusaDasMaos("Ordem desconhecida.", "invalido");
}
