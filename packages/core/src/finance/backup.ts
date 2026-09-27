import { z } from "zod";
import { diaNoMes, mesDe, partes, hojeLocal, type Ymd } from "./calendario";
import { fechamentoDaCompra, vencimentoDaFatura } from "./cartao";
import { corDaVez } from "./padroes";
import { RegraFinanceiraError } from "./operacoes";
import type { DadosFinanceiros } from "./dados";
import type { Cartao } from "./tipos";

/**
 * Backup no formato do app ANTIGO (PRD "Freio de Mão" §3, §9.2, §9.4).
 *
 * Duas mãos:
 * - `exportarBackup`: os dados de HOJE (centavos, uuid) viram o JSON antigo
 *   (reais, ids quaisquer), para servir de "Backup (JSON)" na tela e para o
 *   critério 14.13 aceitar o próprio backup de volta.
 * - `planoDeRestauracao`: o JSON antigo (de um export de verdade ou de uma
 *   migração real) vira linhas prontas para inserir nas tabelas `fin_*`, já
 *   com a manutenção do §4.3 (passos 2 a 5) aplicada. Puro: sem banco, sem
 *   `Date.now()` além do que já vem por parâmetro (`novoId`).
 */

// ── formato antigo (o que sai e o que entra) ────────────────────────────────

export interface ContaAntiga { id: string; nome: string; tipo: "corrente" | "dinheiro"; saldoInicial: number; cor: string }
export interface CartaoAntigo { id: string; nome: string; limite: number; fechamento: number; vencimento: number; contaPagamentoId: string; cor: string }
export interface CategoriaAntiga { id: string; nome: string; tipo: "despesa" | "receita"; cor: string; orcamento: number }

export interface LancamentoAntigo {
  id: string;
  tipo: "despesa" | "receita";
  data: string;
  valor: number;
  descricao: string;
  categoriaId: string;
  contaId: string;
  cartaoId: string;
  transferencia: boolean;
  grupoTransferencia: string;
  fixo: boolean;
  estorno: boolean;
  grupoParcela: string;
  parcelaN: number;
  parcelaDe: number;
  metaId: string;
  metaItemId: string;
  importado: boolean;
  /** legado (§4.3 passo 3): a nova aplicação não grava mais isso, só lê na restauração */
  faturaPaga: boolean;
  criadoEm: number;
}

export interface CompromissoAntigo {
  id: string;
  direcao: "pagar" | "receber";
  descricao: string;
  valor: number;
  vencimento: string;
  categoriaId: string;
  contaId: string;
  recorrencia: "mensal" | "nenhuma";
  serieId: string;
  diaMes: number;
  status: "aberto" | "quitado";
  quitadoEm: string;
  lancamentoId: string;
}

export interface PagamentoFaturaAntigo { id: string; cartaoId: string; fechamento: string; valor: number; data: string; lancamentoId: string; rolado: boolean }
export interface DividaPagamentoAntigo { id: string; data: string; valor: number; juros: number; abatimento: number; lancamentoId: string }
export interface DividaRolagemAntiga { id: string; data: string; valor: number; fechamento: string }

export interface DividaAntiga {
  id: string;
  nome: string;
  tipo: "emprestimo" | "cartao-rotativo" | "cheque-especial" | "crediario" | "outro";
  saldoInicial: number;
  jurosMes: number;
  parcelaMensal: number;
  contaId: string;
  cartaoId: string;
  pagamentos: DividaPagamentoAntigo[];
  rolagens: DividaRolagemAntiga[];
}

export interface PagamentoDeItemAntigo { forma: "avista" | "cartao" | "boleto" | "carne"; parcelas: number; primeiroVenc: string; contaId: string; cartaoId: string }
export interface ImagemAntiga { id: string; dado: string }

export interface ItemDeMetaAntigo {
  id: string;
  grupo: string;
  nome: string;
  valor: number;
  status: "planejado" | "orcado" | "contratado" | "pago";
  obs: string;
  pagamento: PagamentoDeItemAntigo;
  imagens: ImagemAntiga[];
}

export interface MetaAntiga {
  id: string;
  nome: string;
  descricao: string;
  orcamento: number;
  /** reservado, sem uso na interface (§3.9); exportado só por completude */
  prazo: string;
  cor: string;
  criadoEm: string;
  itens: ItemDeMetaAntigo[];
}

export interface AtalhoAntigo { id: string; rotulo: string; valor: number; categoriaId: string; ondeId: string }
export interface RegraAntiga { contem: string; categoriaId: string }

export interface BackupAntigo {
  rev: number;
  tema: "claro" | "escuro" | "auto";
  renda: number;
  limiteMensal: number;
  criadoEm: string;
  contas: ContaAntiga[];
  cartoes: CartaoAntigo[];
  categorias: CategoriaAntiga[];
  lancamentos: LancamentoAntigo[];
  compromissos: CompromissoAntigo[];
  pagamentosFatura: PagamentoFaturaAntigo[];
  dividas: DividaAntiga[];
  metas: MetaAntiga[];
  atalhos: AtalhoAntigo[];
  regras: RegraAntiga[];
}

// ── linhas prontas para inserir (nomes de campo do schema Drizzle) ─────────

export interface LinhaContaRestaurada { id: string; nome: string; tipo: "corrente" | "dinheiro"; saldoInicial: number; cor: string; ordem: number }
export interface LinhaCartaoRestaurado { id: string; nome: string; limite: number; fechamento: number; vencimento: number; contaPagamentoId: string | null; cor: string; ordem: number }
export interface LinhaCategoriaRestaurada { id: string; nome: string; tipo: "despesa" | "receita"; cor: string; orcamento: number; ordem: number }

export interface LinhaLancamentoRestaurado {
  id: string;
  tipo: "despesa" | "receita";
  data: Ymd;
  valor: number;
  descricao: string | null;
  categoriaId: string | null;
  contaId: string | null;
  cartaoId: string | null;
  transferencia: boolean;
  grupoTransferencia: string | null;
  fixo: boolean;
  estorno: boolean;
  grupoParcela: string | null;
  parcelaN: number | null;
  parcelaDe: number | null;
  metaId: string | null;
  metaItemId: string | null;
  compromissoId: string | null;
  importado: boolean;
  criadoEm: Date;
}

export interface LinhaCompromissoRestaurado {
  id: string;
  direcao: "pagar" | "receber";
  descricao: string;
  valor: number;
  vencimento: Ymd;
  categoriaId: string | null;
  contaId: string | null;
  recorrencia: "mensal" | "nenhuma";
  serieId: string | null;
  diaMes: number | null;
  status: "aberto" | "quitado";
  quitadoEm: Ymd | null;
  lancamentoId: string | null;
}

export interface LinhaPagamentoFaturaRestaurado { id: string; cartaoId: string; fechamento: Ymd; valor: number; data: Ymd; lancamentoId: string | null; rolado: boolean }
export interface LinhaDividaRestaurada { id: string; nome: string; tipo: DividaAntiga["tipo"]; saldoInicial: number; jurosMes: number; parcelaMensal: number; contaId: string | null; cartaoId: string | null }
export interface LinhaDividaPagamentoRestaurado { id: string; dividaId: string; data: Ymd; valor: number; juros: number; abatimento: number; lancamentoId: string | null }
export interface LinhaDividaRolagemRestaurada { id: string; dividaId: string; data: Ymd; valor: number; fechamento: Ymd }
export interface LinhaMetaRestaurada { id: string; nome: string; descricao: string | null; orcamento: number; cor: string }

export interface LinhaMetaItemRestaurado {
  id: string;
  metaId: string;
  grupo: string;
  nome: string;
  valor: number;
  status: ItemDeMetaAntigo["status"];
  forma: PagamentoDeItemAntigo["forma"];
  parcelas: number;
  primeiroVenc: Ymd | null;
  contaId: string | null;
  cartaoId: string | null;
  obs: string | null;
  ordem: number;
}

export interface LinhaMetaFotoRestaurada { id: string; itemId: string; dado: string; bytes: number }
export interface LinhaAtalhoRestaurado { id: string; rotulo: string; valor: number; categoriaId: string | null; contaId: string | null; cartaoId: string | null; ordem: number }
export interface LinhaRegraRestaurada { id: string; contem: string; categoriaId: string; ordem: number }

export interface PlanoDeRestauracao {
  perfil: { renda: number; teto: number };
  contas: LinhaContaRestaurada[];
  cartoes: LinhaCartaoRestaurado[];
  categorias: LinhaCategoriaRestaurada[];
  lancamentos: LinhaLancamentoRestaurado[];
  compromissos: LinhaCompromissoRestaurado[];
  pagamentosFatura: LinhaPagamentoFaturaRestaurado[];
  dividas: LinhaDividaRestaurada[];
  dividaPagamentos: LinhaDividaPagamentoRestaurado[];
  dividaRolagens: LinhaDividaRolagemRestaurada[];
  metas: LinhaMetaRestaurada[];
  metaItens: LinhaMetaItemRestaurado[];
  metaFotos: LinhaMetaFotoRestaurada[];
  atalhos: LinhaAtalhoRestaurado[];
  regras: LinhaRegraRestaurada[];
}

// ── exportar (hoje → formato antigo) ────────────────────────────────────────

const paraReais = (centavos: number): number => Math.round(centavos) / 100;

export interface FotoParaExportar { itemId: string; id: string; dado: string }

function agruparFotosPorItem(fotos: FotoParaExportar[]): Map<string, ImagemAntiga[]> {
  const mapa = new Map<string, ImagemAntiga[]>();
  for (const f of fotos) mapa.set(f.itemId, [...(mapa.get(f.itemId) ?? []), { id: f.id, dado: f.dado }]);
  return mapa;
}

/**
 * Os dados de hoje, no formato do app antigo (§3, §9.2). Serve tanto para o
 * botão "Backup (JSON)" quanto para o critério 14.13 (o backup da nova
 * aplicação precisa ser aceito de volta por `planoDeRestauracao`).
 */
export function exportarBackup(d: DadosFinanceiros, fotos: FotoParaExportar[]): BackupAntigo {
  const fotosPorItem = agruparFotosPorItem(fotos);
  return {
    rev: 1,
    tema: "auto",
    renda: paraReais(d.renda),
    limiteMensal: paraReais(d.teto),
    criadoEm: hojeLocal(),
    contas: d.contas.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, saldoInicial: paraReais(c.saldoInicial), cor: c.cor })),
    cartoes: d.cartoes.map((c) => ({
      id: c.id, nome: c.nome, limite: paraReais(c.limite), fechamento: c.fechamento, vencimento: c.vencimento,
      contaPagamentoId: c.contaPagamentoId ?? "", cor: c.cor,
    })),
    categorias: d.categorias.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor, orcamento: paraReais(c.orcamento) })),
    lancamentos: d.lancamentos.map((l) => ({
      id: l.id, tipo: l.tipo, data: l.data, valor: paraReais(l.valor), descricao: l.descricao ?? "",
      categoriaId: l.categoriaId ?? "", contaId: l.contaId ?? "", cartaoId: l.cartaoId ?? "",
      transferencia: l.transferencia, grupoTransferencia: l.grupoTransferencia ?? "",
      fixo: l.fixo, estorno: l.estorno, grupoParcela: l.grupoParcela ?? "",
      parcelaN: l.parcelaN ?? 0, parcelaDe: l.parcelaDe ?? 0,
      metaId: l.metaId ?? "", metaItemId: l.metaItemId ?? "", importado: l.importado,
      // o campo legado nunca é gravado pela aplicação nova: quem tinha faturaPaga true é o app antigo, não este export
      faturaPaga: false,
      criadoEm: l.criadoEm.getTime(),
    })),
    compromissos: d.compromissos.map((c) => ({
      id: c.id, direcao: c.direcao, descricao: c.descricao, valor: paraReais(c.valor), vencimento: c.vencimento,
      categoriaId: c.categoriaId ?? "", contaId: c.contaId ?? "", recorrencia: c.recorrencia,
      serieId: c.serieId ?? "", diaMes: c.diaMes ?? 0, status: c.status,
      quitadoEm: c.quitadoEm ?? "", lancamentoId: c.lancamentoId ?? "",
    })),
    pagamentosFatura: d.pagamentosFatura.map((p) => ({
      id: p.id, cartaoId: p.cartaoId, fechamento: p.fechamento, valor: paraReais(p.valor), data: p.data,
      lancamentoId: p.lancamentoId ?? "", rolado: p.rolado,
    })),
    dividas: d.dividas.map((dv) => ({
      id: dv.id, nome: dv.nome, tipo: dv.tipo, saldoInicial: paraReais(dv.saldoInicial), jurosMes: dv.jurosMes,
      parcelaMensal: paraReais(dv.parcelaMensal), contaId: dv.contaId ?? "", cartaoId: dv.cartaoId ?? "",
      pagamentos: dv.pagamentos.map((p) => ({
        id: p.id, data: p.data, valor: paraReais(p.valor), juros: paraReais(p.juros),
        abatimento: paraReais(p.abatimento), lancamentoId: p.lancamentoId ?? "",
      })),
      rolagens: dv.rolagens.map((r) => ({ id: r.id, data: r.data, valor: paraReais(r.valor), fechamento: r.fechamento })),
    })),
    metas: d.metas.map((m) => ({
      id: m.id, nome: m.nome, descricao: m.descricao ?? "", orcamento: paraReais(m.orcamento), prazo: "", cor: m.cor,
      criadoEm: hojeLocal(m.criadoEm),
      itens: m.itens.map((it) => ({
        id: it.id, grupo: it.grupo, nome: it.nome, valor: paraReais(it.valor), status: it.status, obs: it.obs ?? "",
        pagamento: {
          forma: it.forma, parcelas: it.parcelas, primeiroVenc: it.primeiroVenc ?? "",
          contaId: it.contaId ?? "", cartaoId: it.cartaoId ?? "",
        },
        imagens: fotosPorItem.get(it.id) ?? [],
      })),
    })),
    atalhos: d.atalhos.map((a) => ({
      id: a.id, rotulo: a.rotulo, valor: paraReais(a.valor), categoriaId: a.categoriaId ?? "",
      ondeId: a.cartaoId ? `cartao:${a.cartaoId}` : `conta:${a.contaId ?? ""}`,
    })),
    regras: d.regras.map((r) => ({ contem: r.contem, categoriaId: r.categoriaId })),
  };
}

// ── restaurar (formato antigo → linhas para inserir) ────────────────────────

const DATA_INVALIDA_PADRAO: Ymd = "1970-01-01";

function numero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v.replace(",", ".")); if (Number.isFinite(n)) return n; }
  return 0;
}

function centavosDeReais(reais: number): number {
  return Number.isFinite(reais) ? Math.round(reais * 100) : 0;
}

function paraYmd(v: unknown): Ymd {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : DATA_INVALIDA_PADRAO;
}

function diaValido(v: number, padrao: number): number {
  const n = Math.trunc(v);
  return n >= 1 && n <= 31 ? n : padrao;
}

function idStr(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

// campos texto/número tolerantes: número vindo como id vira string, ausência vira o padrão
// (backups antigos têm campo faltando, não é exceção de um deles: CLAUDE.md §9)
const Texto = (padrao = "") => z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string().catch(padrao));
const NumeroZ = (padrao = 0) => z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? numero(v) : v), z.number().catch(padrao));
const BoolZ = (padrao = false) => z.boolean().catch(padrao);

const ContaAntigaSchema = z.object({ id: Texto(), nome: Texto(), tipo: z.enum(["corrente", "dinheiro"]).catch("corrente"), saldoInicial: NumeroZ(), cor: Texto() });
const CartaoAntigoSchema = z.object({ id: Texto(), nome: Texto(), limite: NumeroZ(), fechamento: NumeroZ(1), vencimento: NumeroZ(10), contaPagamentoId: Texto(), cor: Texto() });
const CategoriaAntigaSchema = z.object({ id: Texto(), nome: Texto(), tipo: z.enum(["despesa", "receita"]).catch("despesa"), cor: Texto(), orcamento: NumeroZ() });

const LancamentoAntigoSchema = z.object({
  id: Texto(), tipo: z.enum(["despesa", "receita"]).catch("despesa"), data: Texto(), valor: NumeroZ(), descricao: Texto(),
  categoriaId: Texto(), contaId: Texto(), cartaoId: Texto(),
  transferencia: BoolZ(), grupoTransferencia: Texto(), fixo: BoolZ(), estorno: BoolZ(),
  grupoParcela: Texto(), parcelaN: NumeroZ(), parcelaDe: NumeroZ(),
  metaId: Texto(), metaItemId: Texto(), importado: BoolZ(), faturaPaga: BoolZ(), criadoEm: NumeroZ(),
});

const CompromissoAntigoSchema = z.object({
  id: Texto(), direcao: z.enum(["pagar", "receber"]).catch("pagar"), descricao: Texto(), valor: NumeroZ(), vencimento: Texto(),
  categoriaId: Texto(), contaId: Texto(), recorrencia: z.enum(["mensal", "nenhuma"]).catch("nenhuma"),
  serieId: Texto(), diaMes: NumeroZ(), status: z.enum(["aberto", "quitado"]).catch("aberto"),
  quitadoEm: Texto(), lancamentoId: Texto(),
});

const PagamentoFaturaAntigoSchema = z.object({ id: Texto(), cartaoId: Texto(), fechamento: Texto(), valor: NumeroZ(), data: Texto(), lancamentoId: Texto(), rolado: BoolZ() });
const DividaPagamentoAntigoSchema = z.object({ id: Texto(), data: Texto(), valor: NumeroZ(), juros: NumeroZ(), abatimento: NumeroZ(), lancamentoId: Texto() });
const DividaRolagemAntigaSchema = z.object({ id: Texto(), data: Texto(), valor: NumeroZ(), fechamento: Texto() });

const DividaAntigaSchema = z.object({
  id: Texto(), nome: Texto(), tipo: z.enum(["emprestimo", "cartao-rotativo", "cheque-especial", "crediario", "outro"]).catch("emprestimo"),
  saldoInicial: NumeroZ(), jurosMes: NumeroZ(), parcelaMensal: NumeroZ(), contaId: Texto(), cartaoId: Texto(),
  pagamentos: z.unknown(), rolagens: z.unknown(),
});

const PagamentoDeItemAntigoSchema = z.object({
  forma: z.enum(["avista", "cartao", "boleto", "carne"]).catch("avista"), parcelas: NumeroZ(1), primeiroVenc: Texto(), contaId: Texto(), cartaoId: Texto(),
});
const PAGAMENTO_DE_ITEM_PADRAO = { forma: "avista" as const, parcelas: 1, primeiroVenc: "", contaId: "", cartaoId: "" };

const ImagemAntigaSchema = z.object({ id: Texto(), dado: Texto() });

const ItemDeMetaAntigoSchema = z.object({
  id: Texto(), grupo: Texto(), nome: Texto(), valor: NumeroZ(), status: z.enum(["planejado", "orcado", "contratado", "pago"]).catch("planejado"),
  obs: Texto(), pagamento: PagamentoDeItemAntigoSchema.catch(PAGAMENTO_DE_ITEM_PADRAO), imagens: z.unknown(),
});

const MetaAntigaSchema = z.object({ id: Texto(), nome: Texto(), descricao: Texto(), orcamento: NumeroZ(), prazo: Texto(), cor: Texto(), criadoEm: Texto(), itens: z.unknown() });
const AtalhoAntigoSchema = z.object({ id: Texto(), rotulo: Texto(), valor: NumeroZ(), categoriaId: Texto(), ondeId: Texto() });
const RegraAntigaSchema = z.object({ contem: Texto(), categoriaId: Texto() });

function paraObjetos(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x));
}
function parseLista<T>(v: unknown, schema: z.ZodType<T>): T[] {
  return paraObjetos(v).map((o) => schema.parse(o));
}

/**
 * Um id antigo (de qualquer formato) vira um uuid novo, com o MESMO uuid
 * sempre que o mesmo id antigo aparecer de novo no mesmo namespace (§ referências
 * cruzadas). `registrar` é para o id PRÓPRIO de uma entidade (sempre ganha um
 * uuid, mesmo se o antigo faltar); `resolver` é para uma REFERÊNCIA a outra
 * entidade (id inexistente vira null, nunca inventa uma entidade nova).
 */
interface Mapeador { registrar(ns: string, idAntigo: unknown): string; resolver(ns: string, idAntigo: unknown): string | null }

function criarMapeador(novoId: () => string): Mapeador {
  const mapas = new Map<string, Map<string, string>>();
  let orfaos = 0;
  const mapaDe = (ns: string): Map<string, string> => {
    let m = mapas.get(ns);
    if (!m) { m = new Map(); mapas.set(ns, m); }
    return m;
  };
  return {
    registrar(ns, idAntigo) {
      const s = idStr(idAntigo) || `__sem_id_${ns}_${orfaos++}`;
      const m = mapaDe(ns);
      let n = m.get(s);
      if (!n) { n = novoId(); m.set(s, n); }
      return n;
    },
    resolver(ns, idAntigo) {
      const s = idStr(idAntigo);
      return s ? (mapaDe(ns).get(s) ?? null) : null;
    },
  };
}

function resolverOnde(ondeId: string, ns: Mapeador): { contaId: string | null; cartaoId: string | null } {
  const m = /^(conta|cartao):(.*)$/.exec(ondeId);
  if (!m) return { contaId: null, cartaoId: null };
  return m[1] === "cartao" ? { contaId: null, cartaoId: ns.resolver("cartao", m[2]) } : { contaId: ns.resolver("conta", m[2]), cartaoId: null };
}

// §4.3 passo 2: reatar séries sem serieId (mesma direção + descrição sem diferenciar maiúsculas) e diaMes ausente = dia do vencimento
function reatarSeries(cs: LinhaCompromissoRestaurado[]): void {
  const chave = (c: LinhaCompromissoRestaurado) => `${c.direcao}|${c.descricao.trim().toLowerCase()}`;
  const ancoras = new Map<string, string>();
  for (const c of cs) if (c.recorrencia === "mensal" && c.serieId) { const k = chave(c); if (!ancoras.has(k)) ancoras.set(k, c.serieId); }
  for (const c of cs) {
    if (c.recorrencia !== "mensal") continue;
    if (!c.serieId) {
      const k = chave(c);
      c.serieId = ancoras.get(k) ?? c.id;
      if (!ancoras.has(k)) ancoras.set(k, c.serieId);
    }
    if (!c.diaMes) c.diaMes = partes(c.vencimento).d;
  }
}

// §4.3 passo 4: entre contas fixas em aberto, mesma direção + descrição + mês de vencimento, mantém só a primeira
function removerDuplicatas(cs: LinhaCompromissoRestaurado[]): LinhaCompromissoRestaurado[] {
  const vistos = new Set<string>();
  return cs.filter((c) => {
    if (c.recorrencia !== "mensal" || c.status !== "aberto") return true;
    const chave = `${c.direcao}|${c.descricao.trim().toLowerCase()}|${mesDe(c.vencimento)}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// §4.3 passo 5: a ocorrência mais antiga da série define o dia; as em aberto com dia diferente são realinhadas
function alinharDiaDasSeries(cs: LinhaCompromissoRestaurado[]): void {
  const porSerie = new Map<string, LinhaCompromissoRestaurado[]>();
  for (const c of cs) if (c.recorrencia === "mensal" && c.serieId) porSerie.set(c.serieId, [...(porSerie.get(c.serieId) ?? []), c]);
  for (const ocorr of porSerie.values()) {
    const primeira = ocorr.reduce((a, b) => (b.vencimento < a.vencimento ? b : a));
    const dia = primeira.diaMes ?? partes(primeira.vencimento).d;
    for (const c of ocorr) {
      if (c.status !== "aberto" || partes(c.vencimento).d === dia) continue;
      c.vencimento = diaNoMes(mesDe(c.vencimento), dia);
      c.diaMes = dia;
    }
  }
}

/**
 * O JSON de um backup (antigo ou o próprio export daqui) vira as linhas
 * prontas para inserir nas tabelas `fin_*` (sem `userId`: quem insere
 * acrescenta). Aplica a manutenção do §4.3 (passos 2 a 5) sobre compromissos
 * e pagamentos de fatura ANTES de devolver; o passo 6 (semear) é do store,
 * que já roda ao carregar.
 */
export function planoDeRestauracao(json: unknown, novoId: () => string): PlanoDeRestauracao {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new RegraFinanceiraError("Esse texto não é um backup válido.");
  }
  const bruto = json as Record<string, unknown>;
  if (!Array.isArray(bruto.lancamentos)) {
    throw new RegraFinanceiraError("Backup sem lançamentos. Verifique o arquivo.");
  }

  const ns = criarMapeador(novoId);

  // fase A: registra o id PRÓPRIO de cada entidade primeiro, para nenhuma referência
  // cruzada (fase B) depender da ordem em que as listas aparecem no JSON.
  const contasInt = parseLista(bruto.contas, ContaAntigaSchema).map((c) => ({ ...c, novoId: ns.registrar("conta", c.id) }));
  const cartoesInt = parseLista(bruto.cartoes, CartaoAntigoSchema).map((c) => ({ ...c, novoId: ns.registrar("cartao", c.id) }));
  const categoriasInt = parseLista(bruto.categorias, CategoriaAntigaSchema).map((c) => ({ ...c, novoId: ns.registrar("categoria", c.id) }));
  const lancamentosInt = parseLista(bruto.lancamentos, LancamentoAntigoSchema).map((l) => ({ ...l, novoId: ns.registrar("lancamento", l.id) }));
  const compromissosInt = parseLista(bruto.compromissos, CompromissoAntigoSchema).map((c) => ({ ...c, novoId: ns.registrar("compromisso", c.id) }));
  const dividasInt = parseLista(bruto.dividas, DividaAntigaSchema).map((d) => ({ ...d, novoId: ns.registrar("divida", d.id) }));
  const atalhosInt = parseLista(bruto.atalhos, AtalhoAntigoSchema).map((a) => ({ ...a, novoId: ns.registrar("atalho", a.id) }));
  const metasInt = parseLista(bruto.metas, MetaAntigaSchema).map((m) => ({
    ...m,
    novoId: ns.registrar("meta", m.id),
    itensInt: parseLista(m.itens, ItemDeMetaAntigoSchema).map((it) => ({ ...it, novoId: ns.registrar("metaItem", it.id) })),
  }));

  // fase B: monta as linhas finais, resolvendo referências (id inexistente vira null)

  const contas: LinhaContaRestaurada[] = contasInt.map((c, i) => ({
    id: c.novoId, nome: c.nome || `Conta ${i + 1}`, tipo: c.tipo, saldoInicial: centavosDeReais(c.saldoInicial), cor: c.cor || corDaVez(i), ordem: i,
  }));

  const cartoes: LinhaCartaoRestaurado[] = cartoesInt.map((c, i) => ({
    id: c.novoId, nome: c.nome || `Cartão ${i + 1}`, limite: centavosDeReais(c.limite),
    fechamento: diaValido(c.fechamento, 1), vencimento: diaValido(c.vencimento, 10),
    contaPagamentoId: ns.resolver("conta", c.contaPagamentoId), cor: c.cor || corDaVez(i), ordem: i,
  }));

  const categorias: LinhaCategoriaRestaurada[] = categoriasInt.map((c, i) => ({
    id: c.novoId, nome: c.nome || `Categoria ${i + 1}`, tipo: c.tipo, cor: c.cor || corDaVez(i), orcamento: centavosDeReais(c.orcamento), ordem: i,
  }));

  // desempate de ordenação quando o backup não trouxe criadoEm (§3.5): mantém a ordem original da lista
  const BASE_CRIADO_EM = Date.parse("2020-01-01T00:00:00.000Z");
  const lancamentos: LinhaLancamentoRestaurado[] = lancamentosInt.map((l, i) => ({
    id: l.novoId, tipo: l.tipo, data: paraYmd(l.data), valor: centavosDeReais(l.valor), descricao: l.descricao || null,
    categoriaId: ns.resolver("categoria", l.categoriaId), contaId: ns.resolver("conta", l.contaId), cartaoId: ns.resolver("cartao", l.cartaoId),
    transferencia: l.transferencia,
    grupoTransferencia: l.grupoTransferencia ? ns.registrar("grupoTransferencia", l.grupoTransferencia) : null,
    fixo: l.fixo, estorno: l.estorno,
    grupoParcela: l.grupoParcela ? ns.registrar("grupoParcela", l.grupoParcela) : null,
    parcelaN: l.parcelaN > 0 ? l.parcelaN : null, parcelaDe: l.parcelaDe > 0 ? l.parcelaDe : null,
    metaId: ns.resolver("meta", l.metaId), metaItemId: ns.resolver("metaItem", l.metaItemId),
    compromissoId: null, importado: l.importado,
    criadoEm: l.criadoEm > 0 ? new Date(l.criadoEm) : new Date(BASE_CRIADO_EM + i),
  }));

  let compromissos: LinhaCompromissoRestaurado[] = compromissosInt.map((c) => ({
    id: c.novoId, direcao: c.direcao, descricao: c.descricao || "Conta", valor: centavosDeReais(c.valor), vencimento: paraYmd(c.vencimento),
    categoriaId: ns.resolver("categoria", c.categoriaId), contaId: ns.resolver("conta", c.contaId), recorrencia: c.recorrencia,
    serieId: ns.resolver("compromisso", c.serieId), diaMes: c.diaMes > 0 ? c.diaMes : null, status: c.status,
    quitadoEm: c.quitadoEm ? paraYmd(c.quitadoEm) : null, lancamentoId: ns.resolver("lancamento", c.lancamentoId),
  }));
  reatarSeries(compromissos);
  compromissos = removerDuplicatas(compromissos);
  alinharDiaDasSeries(compromissos);

  // §4.3 passo 3: migrar faturaPaga. Para cada fatura (cartão + fechamento) em que TODAS as
  // compras estavam marcadas como pagas, cria um pagamento de fatura com o total, se ainda não existir um.
  const pagamentosFaturaBase: LinhaPagamentoFaturaRestaurado[] = parseLista(bruto.pagamentosFatura, PagamentoFaturaAntigoSchema)
    .map((p) => ({ cartaoId: ns.resolver("cartao", p.cartaoId), fechamento: paraYmd(p.fechamento), valor: centavosDeReais(p.valor), data: paraYmd(p.data), lancamentoId: ns.resolver("lancamento", p.lancamentoId), rolado: p.rolado }))
    .filter((p): p is { cartaoId: string; fechamento: Ymd; valor: number; data: Ymd; lancamentoId: string | null; rolado: boolean } => p.cartaoId !== null)
    .map((p) => ({ id: novoId(), cartaoId: p.cartaoId, fechamento: p.fechamento, valor: p.valor, data: p.data, lancamentoId: p.lancamentoId, rolado: p.rolado }));

  const existentes = new Set(pagamentosFaturaBase.map((p) => `${p.cartaoId}|${p.fechamento}`));
  const migradosDeFaturaPaga: LinhaPagamentoFaturaRestaurado[] = [];
  for (const cartao of cartoesInt) {
    const cartaoCalc: Cartao = { id: cartao.novoId, limite: 0, fechamento: diaValido(cartao.fechamento, 1), vencimento: diaValido(cartao.vencimento, 10) };
    const comprasDoCartao = lancamentosInt.filter((l) => idStr(l.cartaoId) === idStr(cartao.id) && idStr(cartao.id) !== "");
    const grupos = new Map<Ymd, typeof comprasDoCartao>();
    for (const l of comprasDoCartao) {
      const f = fechamentoDaCompra(cartaoCalc, paraYmd(l.data));
      grupos.set(f, [...(grupos.get(f) ?? []), l]);
    }
    for (const [fechamento, compras] of grupos) {
      if (!compras.every((l) => l.faturaPaga)) continue;
      const chave = `${cartao.novoId}|${fechamento}`;
      if (existentes.has(chave)) continue;
      const total = compras.reduce((s, l) => s + (l.tipo === "despesa" ? centavosDeReais(l.valor) : -centavosDeReais(l.valor)), 0);
      migradosDeFaturaPaga.push({ id: novoId(), cartaoId: cartao.novoId, fechamento, valor: total, data: vencimentoDaFatura(cartaoCalc, fechamento), lancamentoId: null, rolado: false });
      existentes.add(chave);
    }
  }
  const pagamentosFatura: LinhaPagamentoFaturaRestaurado[] = [...pagamentosFaturaBase, ...migradosDeFaturaPaga];

  const dividas: LinhaDividaRestaurada[] = dividasInt.map((d) => ({
    id: d.novoId, nome: d.nome || "Dívida", tipo: d.tipo, saldoInicial: centavosDeReais(d.saldoInicial), jurosMes: d.jurosMes,
    parcelaMensal: centavosDeReais(d.parcelaMensal), contaId: ns.resolver("conta", d.contaId), cartaoId: ns.resolver("cartao", d.cartaoId),
  }));
  const dividaPagamentos: LinhaDividaPagamentoRestaurado[] = dividasInt.flatMap((d) =>
    parseLista(d.pagamentos, DividaPagamentoAntigoSchema).map((p) => ({
      id: novoId(), dividaId: d.novoId, data: paraYmd(p.data), valor: centavosDeReais(p.valor), juros: centavosDeReais(p.juros),
      abatimento: centavosDeReais(p.abatimento), lancamentoId: ns.resolver("lancamento", p.lancamentoId),
    })),
  );
  const dividaRolagens: LinhaDividaRolagemRestaurada[] = dividasInt.flatMap((d) =>
    parseLista(d.rolagens, DividaRolagemAntigaSchema).map((r) => ({ id: novoId(), dividaId: d.novoId, data: paraYmd(r.data), valor: centavosDeReais(r.valor), fechamento: paraYmd(r.fechamento) })),
  );

  const metas: LinhaMetaRestaurada[] = metasInt.map((m, i) => ({ id: m.novoId, nome: m.nome || `Meta ${i + 1}`, descricao: m.descricao || null, orcamento: centavosDeReais(m.orcamento), cor: m.cor || corDaVez(i) }));

  const metaItens: LinhaMetaItemRestaurado[] = [];
  const metaFotos: LinhaMetaFotoRestaurada[] = [];
  for (const m of metasInt) {
    m.itensInt.forEach((it, i) => {
      metaItens.push({
        id: it.novoId, metaId: m.novoId, grupo: it.grupo || "Sem grupo", nome: it.nome || `Item ${i + 1}`, valor: centavosDeReais(it.valor),
        status: it.status, forma: it.pagamento.forma, parcelas: it.pagamento.parcelas > 0 ? Math.min(48, Math.floor(it.pagamento.parcelas)) : 1,
        primeiroVenc: it.pagamento.primeiroVenc ? paraYmd(it.pagamento.primeiroVenc) : null,
        contaId: ns.resolver("conta", it.pagamento.contaId), cartaoId: ns.resolver("cartao", it.pagamento.cartaoId),
        obs: it.obs || null, ordem: i,
      });
      for (const img of parseLista(it.imagens, ImagemAntigaSchema)) {
        if (!img.dado) continue;
        metaFotos.push({ id: novoId(), itemId: it.novoId, dado: img.dado, bytes: Math.round((img.dado.length * 3) / 4) });
      }
    });
  }

  const atalhos: LinhaAtalhoRestaurado[] = atalhosInt.map((a, i) => {
    const onde = resolverOnde(a.ondeId, ns);
    return { id: a.novoId, rotulo: a.rotulo || `Atalho ${i + 1}`, valor: centavosDeReais(a.valor), categoriaId: ns.resolver("categoria", a.categoriaId), contaId: onde.contaId, cartaoId: onde.cartaoId, ordem: i };
  });

  // finRegra.categoriaId é NOT NULL: regra cuja categoria não existe mais no backup não pode ser inserida
  const regras: LinhaRegraRestaurada[] = parseLista(bruto.regras, RegraAntigaSchema)
    .map((r) => ({ contem: r.contem.trim(), categoriaId: ns.resolver("categoria", r.categoriaId) }))
    .filter((r): r is { contem: string; categoriaId: string } => r.contem !== "" && r.categoriaId !== null)
    .map((r, i) => ({ id: novoId(), contem: r.contem, categoriaId: r.categoriaId, ordem: i }));

  return {
    perfil: { renda: centavosDeReais(numero(bruto.renda)), teto: centavosDeReais(numero(bruto.limiteMensal)) },
    contas, cartoes, categorias, lancamentos, compromissos, pagamentosFatura,
    dividas, dividaPagamentos, dividaRolagens, metas, metaItens, metaFotos, atalhos, regras,
  };
}
