import { settings } from "../settings";
import { log } from "../observability/logger";
import { ErroDaExtensao, extensaoConectada, ordemAExtensao } from "./canal";
import { RecusaDasMaos } from "./executor";
import type { Ordem, OrigemDaOrdem, ResultadoDaOrdem } from "./protocolo";
import { regraParaExtensao, regrasDeSite } from "./sites";

/**
 * QUAL CHROME RECEBE A ORDEM (PRD B5 e B6).
 *
 *   - pedido do dono (chat, voz, WhatsApp "Eu") → o Chrome DELE, pela extensão;
 *   - rotina e regra (ninguém olhando) → o PERFIL DEDICADO, nunca o real.
 *
 * A escolha mora aqui E na extensão: a ordem leva a origem, e a extensão no
 * perfil real recusa `rotina` e `regra` do lado dela. Se um bug do api mandar
 * uma ordem de rotina ao perfil real, ela é recusada lá também.
 *
 * O perfil da ordem é FIXADO na proposta (`preparar`), porque a execução
 * depois da aprovação não sabe mais de onde o pedido veio.
 */

export type Perfil = "real" | "dedicado";

export function perfilDaOrigem(origem: OrigemDaOrdem): Perfil {
  return origem === "dono" ? "real" : "dedicado";
}

let dedicadoLigado = false;

/** Lê a config do perfil dedicado para o `requires.available` (síncrono). O gateway chama isto num laço. */
export async function atualizarDisponibilidade(): Promise<void> {
  dedicadoLigado = await settings.get("navegador.perfilDedicado").catch(() => false);
}

/** As tools do navegador aparecem? Com a extensão conectada ou o perfil dedicado ligado. Síncrono. */
export function navegadorDisponivel(): boolean {
  return extensaoConectada() || dedicadoLigado;
}

/**
 * Para QUEM o turno é. Rotina e regra só usam o perfil dedicado: com ele
 * desligado as tools do navegador nem entram no turno delas (antes entravam,
 * porque a extensão do dono estava conectada, e toda chamada falhava com
 * "perfil dedicado desligado"). O dono usa o Chrome dele: sem a extensão, não
 * há onde agir. Síncrono.
 */
export function navegadorDisponivelPara(origem: OrigemDaOrdem | null | undefined): boolean {
  return origem && origem !== "dono" ? dedicadoLigado : extensaoConectada();
}

export class ErroDoNavegador extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
  ) {
    super(message);
    this.name = "ErroDoNavegador";
  }
}

/**
 * Manda a ordem ao Chrome certo e devolve o resultado. Recusa vira
 * `ErroDoNavegador` com a frase pronta para o modelo.
 */
export async function ordemAoNavegador(userId: string, ordem: Ordem, c: { origem: OrigemDaOrdem; perfil?: Perfil }): Promise<ResultadoDaOrdem> {
  const perfil = c.perfil ?? perfilDaOrigem(c.origem);
  if (perfil === "real" && c.origem !== "dono") throw new ErroDoNavegador("Rotina e regra nunca mexem no seu Chrome: só no perfil dedicado.", "origem_recusada");
  const cfg = await settings.getMany(["navegador.ordemTimeoutMs", "navegador.agindoMs", "navegador.perfilDedicado"]);
  try {
    if (perfil === "real") return await ordemAExtensao(userId, ordem, c.origem, cfg["navegador.ordemTimeoutMs"]);
    if (!cfg["navegador.perfilDedicado"]) throw new ErroDoNavegador("O perfil dedicado do Chrome está desligado em Ajustes (Perfil dedicado para rotinas).", "dedicado_desligado");
    const { ordemAoDedicado } = await import("./dedicado");
    const sites = regraParaExtensao(await regrasDeSite(userId));
    return await ordemAoDedicado(ordem, sites, { agindoMs: cfg["navegador.agindoMs"], timeoutMs: cfg["navegador.ordemTimeoutMs"], userId });
  } catch (e) {
    if (e instanceof ErroDoNavegador) throw e;
    if (e instanceof ErroDaExtensao || e instanceof RecusaDasMaos) throw new ErroDoNavegador(e.message, e.codigo);
    log.warn("navegador.ordem_falhou", { userId, tipo: ordem.tipo, perfil, erro: e instanceof Error ? e.message : String(e) });
    throw new ErroDoNavegador(e instanceof Error ? e.message.slice(0, 300) : "O Chrome não conseguiu.", "falhou");
  }
}
