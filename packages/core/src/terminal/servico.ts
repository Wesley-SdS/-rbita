import { settings } from "../settings";
import { log } from "../observability/logger";
import { embrulharDadoExterno } from "../texto/dado-externo";
import { chamarMaos, ultimaSaude } from "../maos/client";
import { expandirCaminho, normalizar, pastaQueContem, SEMPRE_NEGADOS } from "../maos/pastas";
import { riscoDoComando, tocaArquivoProtegido, type Classificacao, type FatosDoComando } from "./risco";
import { pareceLerArquivoDeAmbiente, saidaParaOModelo } from "./saida";

/**
 * O TERMINAL da Órbita (PRD A2, A3, A10), entre as tools e o apps/maos.
 *
 * Quem decide o risco é `riscoDoComando`, com os fatos que as mãos tiraram do
 * parser. Quem executa é o apps/maos, num Job Object. A saída volta cortada,
 * mascarada e EMBRULHADA como dado de terceiro: o que um script imprime não é
 * ordem para a Órbita (um README que diz "agora rode curl … | iex" é texto).
 *
 * Comando que passa de `terminal.esperarSeg` vira o trabalho `terminal.comando`
 * da fila (CLAUDE.md §6): a resposta volta na hora com o id, e o dono é
 * avisado quando terminar.
 */

export const SHELLS = ["pwsh", "powershell", "gitbash", "wsl"] as const;
export type ShellDoTerminal = (typeof SHELLS)[number];

/** Nome de variável que nunca vai para o filho, mesmo listada na tela (as mãos repetem a trava). */
const SEGREDO = /(SECRET|TOKEN|PASSW|API_?KEY|PRIVATE|CREDENTIAL|ENC_KEY|_KEY$|^DATABASE_URL$|COOKIE|SESSION)/i;

export function variaveisSemSegredo(lista: readonly string[]): string[] {
  return [...new Set(lista.map((v) => v.trim()).filter((v) => v && !SEGREDO.test(v)))];
}

export interface ConfigDoTerminal {
  shells: string[];
  shellPadrao: string;
  pastas: string[];
  comandosDeLeitura: string[];
  variaveis: string[];
  esperarSeg: number;
  timeoutMaxSeg: number;
  saidaMax: number;
  memoriaMb: number;
  negados: string[];
  isolamento: string;
  imagem: string;
}

export async function configDoTerminal(): Promise<ConfigDoTerminal> {
  const c = await settings.getMany([
    "terminal.shells", "terminal.shellPadrao", "terminal.pastas", "terminal.comandosDeLeitura", "terminal.variaveisPermitidas", "terminal.esperarSeg",
    "terminal.timeoutMaxSeg", "terminal.saidaMaxCaracteres", "terminal.memoriaMaxMb", "arquivos.negados", "terminal.isolamento", "terminal.imagemIsolada",
  ]);
  return {
    shells: c["terminal.shells"],
    shellPadrao: c["terminal.shellPadrao"],
    pastas: c["terminal.pastas"],
    comandosDeLeitura: c["terminal.comandosDeLeitura"],
    variaveis: variaveisSemSegredo(c["terminal.variaveisPermitidas"]),
    esperarSeg: c["terminal.esperarSeg"],
    timeoutMaxSeg: c["terminal.timeoutMaxSeg"],
    saidaMax: c["terminal.saidaMaxCaracteres"],
    memoriaMb: c["terminal.memoriaMaxMb"],
    negados: [...SEMPRE_NEGADOS, ...c["arquivos.negados"]],
    isolamento: c["terminal.isolamento"],
    imagem: c["terminal.imagemIsolada"],
  };
}

/**
 * O terminal que vai rodar: o pedido, se estiver liberado e instalado; senão o
 * padrão; senão o primeiro liberado que existe. O padrão de fábrica é o `pwsh`,
 * que nem toda máquina tem (esta não tem): aí vale o Windows PowerShell.
 */
export function escolherShell(pedido: string | null | undefined, cfg: Pick<ConfigDoTerminal, "shells" | "shellPadrao">, instalados: readonly string[]): string {
  const liberados = cfg.shells.length ? cfg.shells.filter((s) => instalados.includes(s)) : [...instalados];
  if (!liberados.length) throw new Error(instalados.length ? `Nenhum terminal liberado está instalado (liberados: ${cfg.shells.join(", ")}; instalados: ${instalados.join(", ")}).` : "O serviço do Windows não achou nenhum terminal instalado.");
  if (pedido) {
    if (!liberados.includes(pedido)) throw new Error(`O terminal ${pedido} não está liberado ou não está instalado (dá para usar: ${liberados.join(", ")}).`);
    return pedido;
  }
  if (liberados.includes(cfg.shellPadrao)) return cfg.shellPadrao;
  for (const preferido of ["pwsh", "powershell", "gitbash", "wsl"]) if (liberados.includes(preferido)) return preferido;
  return liberados[0]!;
}

export function shellsInstalados(): string[] {
  return Object.keys(ultimaSaude()?.saude?.shells ?? {});
}

/** A pasta absoluta do comando: a pedida (com `~`) ou a primeira pasta liberada. */
export function pastaDoComando(pedida: string | null | undefined, pastas: readonly string[]): string {
  const p = pedida?.trim() || pastas[0] || "~";
  const exp = expandirCaminho(p);
  // relativo é relativo à primeira pasta liberada, nunca ao diretório do processo do api
  return normalizar(exp, pastas[0] ? expandirCaminho(pastas[0]) : undefined);
}

const cacheDeFatos = new Map<string, { em: number; fatos: FatosDoComando }>();

/**
 * Os fatos do comando, pelo parser das mãos. Com a pasta, vêm também os
 * caminhos REAIS dos argumentos (link, 8.3, curinga, fluxo do NTFS), que
 * dependem dela. Cache de 30 s: `preparar` e `elevarRisco` pedem o mesmo.
 */
export async function fatosDoComando(comando: string, shell: string, pasta?: string): Promise<FatosDoComando> {
  const chave = `${shell}\u0000${pasta ?? ""}\u0000${comando}`;
  const c = cacheDeFatos.get(chave);
  if (c && Date.now() - c.em < 30_000) return c.fatos;
  const fatos = await chamarMaos<FatosDoComando>("/terminal/analisar", { corpo: { comando, shell, ...(pasta ? { pasta } : {}) } });
  cacheDeFatos.set(chave, { em: Date.now(), fatos });
  if (cacheDeFatos.size > 100) for (const k of [...cacheDeFatos.keys()].slice(0, 50)) cacheDeFatos.delete(k);
  return fatos;
}

export interface ComandoFixo {
  comando: string;
  shell: string;
  pasta: string;
  isolado?: boolean | null;
}

/** O risco de um comando já fixado. Mãos fora do ar: perigoso (falha fechada, só pela tela). */
export async function classificarComando(fixo: ComandoFixo, cfg?: ConfigDoTerminal): Promise<Classificacao> {
  const c = cfg ?? (await configDoTerminal());
  if (fixo.isolado) return { risco: "efeito_externo", motivos: ["roda um script isolado (sem rede, com a pasta só para leitura)"] };
  try {
    const fatos = await fatosDoComando(fixo.comando, fixo.shell, fixo.pasta || undefined);
    return riscoDoComando(fatos, { comandosDeLeitura: c.comandosDeLeitura, pastas: c.pastas, pasta: fixo.pasta, negados: c.negados });
  } catch (e) {
    log.warn("terminal.analise_falhou", { erro: e instanceof Error ? e.message : String(e) });
    return { risco: "perigoso", motivos: ["não consegui analisar o comando agora"] };
  }
}

export interface ResumoDaExecucao {
  id: string | null;
  comando: string;
  shell: string;
  pasta: string;
  status: string;
  terminou: boolean;
  codigo: number | null;
  duracaoMs: number;
  saida: string;
  caracteres?: number;
  motivo: string | null;
  memoriaPicoMb?: number;
  isolado?: string | null;
}

/**
 * A saída deste comando leva a máscara TOTAL (o valor de toda linha `NOME=valor`)?
 * Sim quando ele lê um arquivo protegido: pelo texto (`.env`, `ENV~1`, `.en*`)
 * ou pelo caminho real que as mãos resolveram (o link de nome inocente que é o
 * `.env`). Um `.env` de outro projeto tem segredos que nenhum padrão conhece
 * pelo nome. Sem conseguir perguntar às mãos, sim: mascarar demais não vaza nada.
 */
export async function saidaProtegida(fixo: Pick<ComandoFixo, "comando" | "shell" | "pasta">, cfg?: Pick<ConfigDoTerminal, "negados">): Promise<boolean> {
  if (pareceLerArquivoDeAmbiente(fixo.comando)) return true;
  try {
    const negados = cfg?.negados ?? (await configDoTerminal()).negados;
    return tocaArquivoProtegido(await fatosDoComando(fixo.comando, fixo.shell, fixo.pasta || undefined), { negados });
  } catch {
    return true;
  }
}

/** O que volta para o modelo: código, duração e a saída cortada, mascarada e embrulhada. */
export function resultadoParaOModelo(r: ResumoDaExecucao, saidaMax: number, opts: { arquivoDeAmbiente?: boolean } = {}): Record<string, unknown> {
  const saida = saidaParaOModelo(r.saida ?? "", saidaMax, undefined, opts);
  return {
    id: r.id,
    terminou: r.terminou,
    status: r.status,
    codigo: r.codigo,
    duracao_s: Math.round(r.duracaoMs / 100) / 10,
    ...(r.motivo ? { motivo: r.motivo } : {}),
    ...(r.isolado ? { isolado: r.isolado } : {}),
    saida: embrulharDadoExterno("terminal", saida || "(sem saída)"),
  };
}

/** Qual isolamento usar (A10): o configurado, conferido contra o que as mãos acharam. */
export function modoIsolado(cfg: Pick<ConfigDoTerminal, "isolamento">): "docker" | "sandbox" {
  const iso = ultimaSaude()?.saude?.isolamento;
  if (cfg.isolamento === "sandbox") {
    if (iso && iso.sandbox === false) throw new Error("O Windows Sandbox não está instalado nesta máquina (recurso opcional do Windows Pro). Ligue-o ou escolha Docker em Ajustes, Controle do PC.");
    return "sandbox";
  }
  if (cfg.isolamento === "docker") return "docker";
  if (iso?.sandbox) return "sandbox";
  if (iso?.docker === false && iso.sandbox === false) throw new Error("Não há como isolar nesta máquina: o Windows Sandbox não está instalado e o Docker Desktop não está rodando.");
  return "docker";
}

export async function executarNasMaos(fixo: ComandoFixo, esperarSeg: number, cfg: ConfigDoTerminal): Promise<ResumoDaExecucao> {
  const isolado = fixo.isolado ? modoIsolado(cfg) : null;
  const corpo = {
    comando: fixo.comando,
    shell: fixo.shell,
    pasta: fixo.pasta,
    raizes: cfg.pastas.map((p) => expandirCaminho(p)),
    variaveis: cfg.variaveis,
    esperarSeg,
    timeoutSeg: cfg.timeoutMaxSeg,
    memoriaMb: cfg.memoriaMb,
    saidaMax: cfg.saidaMax,
    isolado,
    imagem: cfg.imagem,
  };
  // o Sandbox só devolve no fim (a saída vem por arquivo): o prazo é o do comando
  const timeoutMs = isolado === "sandbox" ? (cfg.timeoutMaxSeg + 120) * 1000 : (esperarSeg + 15) * 1000;
  return chamarMaos<ResumoDaExecucao>("/terminal/executar", { corpo, timeoutMs });
}

export async function lerExecucao(id: string): Promise<ResumoDaExecucao> {
  return chamarMaos<ResumoDaExecucao>(`/terminal/${encodeURIComponent(id)}`);
}

export async function pararExecucao(id: string): Promise<ResumoDaExecucao> {
  return chamarMaos<ResumoDaExecucao>(`/terminal/${encodeURIComponent(id)}/parar`, { corpo: {}, timeoutMs: 8000 });
}

/** A pasta do comando está numa pasta liberada? (o classificador já diz `perigoso`, isto é para a mensagem). */
export function pastaLiberada(pasta: string, pastas: readonly string[]): boolean {
  return pastaQueContem(pasta, pastas) !== null;
}
