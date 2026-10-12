import { stat } from "node:fs/promises";
import { settings } from "../settings";
import { chamarMaos, maosDisponivel } from "./client";
import { expandirCaminho, normalizar } from "./pastas";
import { classificarComando, configDoTerminal, escolherShell, pastaDoComando, shellsInstalados } from "../terminal/servico";
import type { ToolRisk } from "../tools/registry";

/**
 * O que os blocos da tela "Controle do PC" mostram da frente A (PRD F7):
 * pastas liberadas (com o caminho de verdade e se existe), os apps abertos
 * agora (para escolher quais esconder) e o teste de um comando no
 * classificador, SEM rodar.
 *
 * Nada aqui muda permissão: a lista de pastas, de apps ocultos e de comandos
 * de leitura muda pela tela de Ajustes (`PUT /api/settings`, com OwnerGuard).
 * Por isso não existe tool disto (PRD §2.3).
 */

export interface PastaNaTela {
  /** como está na config ("~/Documents") */
  config: string;
  /** o caminho de verdade nesta máquina */
  caminho: string;
  existe: boolean;
}

async function conferirPastas(lista: readonly string[]): Promise<PastaNaTela[]> {
  return Promise.all(
    lista.map(async (p) => {
      const caminho = expandirCaminho(p);
      const existe = await stat(caminho).then((s) => s.isDirectory(), () => false);
      return { config: p, caminho, existe };
    }),
  );
}

export async function pastasParaATela(): Promise<{ terminal: PastaNaTela[]; arquivos: PastaNaTela[]; anexos: PastaNaTela; shells: string[]; maosLigadas: boolean }> {
  const c = await settings.getMany(["terminal.pastas", "arquivos.pastas", "arquivos.pastaDosAnexos"]);
  const [terminal, arquivos, [anexos]] = await Promise.all([conferirPastas(c["terminal.pastas"]), conferirPastas(c["arquivos.pastas"]), conferirPastas([c["arquivos.pastaDosAnexos"]])]);
  return { terminal, arquivos, anexos: anexos!, shells: shellsInstalados(), maosLigadas: maosDisponivel() };
}

export interface AppAberto {
  app: string;
  exe: string;
  /** já sai pintado de preto e fora da árvore */
  oculto: boolean;
  janelas: number;
}

/**
 * Os apps com janela aberta AGORA, um por executável. Só o nome do app: o
 * título da janela é conteúdo (um e-mail aberto, um documento) e não serve
 * para escolher o que esconder.
 */
export async function appsAbertosParaATela(): Promise<{ apps: AppAberto[]; ocultos: string[]; maosLigadas: boolean }> {
  const ocultos = await settings.get("computador.appsOcultos");
  if (!maosDisponivel()) return { apps: [], ocultos, maosLigadas: false };
  const r = await chamarMaos<{ janelas: { app: string; exe: string; oculta: boolean }[] }>("/computador/janelas", { corpo: { ocultos } });
  const porExe = new Map<string, AppAberto>();
  for (const j of r.janelas) {
    const k = (j.exe || j.app).toLowerCase();
    const a = porExe.get(k) ?? { app: j.app || j.exe, exe: j.exe, oculto: false, janelas: 0 };
    a.janelas++;
    a.oculto = a.oculto || j.oculta;
    porExe.set(k, a);
  }
  return { apps: [...porExe.values()].sort((a, b) => a.app.localeCompare(b.app, "pt-BR")), ocultos, maosLigadas: true };
}

/** A lista de comandos de leitura e os terminais, para o bloco "comandos". */
export async function comandosParaATela(): Promise<{ comandos: string[]; shellPadrao: string; shells: string[] }> {
  const c = await settings.getMany(["terminal.comandosDeLeitura", "terminal.shellPadrao"]);
  return { comandos: c["terminal.comandosDeLeitura"], shellPadrao: c["terminal.shellPadrao"], shells: shellsInstalados() };
}

/** O risco que o classificador daria a este comando, sem rodar nada. */
export async function classificarParaATela(comando: string, shell?: string | null, pasta?: string | null): Promise<{ risco: ToolRisk; motivos: string[]; shell: string; pasta: string }> {
  const cfg = await configDoTerminal();
  const sh = escolherShell(shell ?? null, cfg, shellsInstalados());
  const p = pastaDoComando(pasta ?? null, cfg.pastas);
  const c = await classificarComando({ comando, shell: sh, pasta: p }, cfg);
  return { risco: c.risco, motivos: c.motivos, shell: sh, pasta: normalizar(p) };
}
