import { settings } from "../settings";
import { getOwnerId } from "../owner";
import { log } from "../observability/logger";
import { registrarEspelho, type EventoDoEspelho, type MaosEspelho } from "../controle/espelho";
import { registrarBloco, registrarEstadoDasMaos, type EstadoDeMao } from "../controle/estado";
import { atualizarSaude, chamarMaos, hashDaConfig, maosDisponivel, tokenDasMaos, ultimaSaude, type AvisoDasMaos } from "./client";

/**
 * As mãos do Windows ligadas ao resto da Órbita (PRD A1, F2, F6, F7):
 *
 *   - ESPELHO: cada mudança de sessão chega ao apps/maos (`PUT /envelope`,
 *     `POST /envelope/fim`, `POST /parar`), que passa a recusar sozinho o que
 *     estiver fora;
 *   - ESTADO: a tela "Controle do PC" lê o último /health guardado pelo laço;
 *   - BLOCOS: pastas, apps ocultos e comandos de leitura aparecem na tela;
 *   - LAÇO `maos` (SchedulerService): /health, a config que as mãos precisam
 *     saber sozinhas (o atalho de parar e os apps ocultos) e os AVISOS que
 *     ficaram pendentes (o api estava fora quando o dono apertou o atalho).
 *
 * O AVISO das mãos ("o dono apertou o atalho", "mexeu no mouse") é tratado
 * aqui, pelo código: o parar e a pausa já aconteceram do lado de lá; aqui as
 * sessões param no banco, a fila é limpa e o evento sai.
 */

export const espelhoDasMaos: MaosEspelho = {
  nome: "maos",
  async notificar(e: EventoDoEspelho): Promise<void> {
    // sem token, não há mãos: o espelho não tem a quem avisar (e não é erro de sessão)
    if (!tokenDasMaos()) return;
    if (e.tipo === "envelope") {
      if (e.envelope.alvo === "navegador") return; // só o Chrome: as mãos do Windows não entram
      await chamarMaos("/envelope", { metodo: "PUT", corpo: e.envelope });
    } else if (e.tipo === "fim") {
      await chamarMaos("/envelope/fim", { corpo: { sessaoId: e.sessaoId, status: e.status, motivo: e.motivo } });
    } else {
      await chamarMaos("/parar", { corpo: { origem: e.origem.slice(0, 60) } });
    }
  },
};

export function estadoDasMaosAgora(): EstadoDeMao {
  const v = ultimaSaude();
  if (!tokenDasMaos()) return { ligado: false, detalhe: "Falta o MAOS_TOKEN no .env da raiz. Rode apps/maos/scripts/instalar.ps1, que gera o token e registra o serviço no logon." };
  if (!v) return { ligado: false, detalhe: "Ainda não consegui falar com o serviço local do Windows." };
  if (!maosDisponivel() || !v.saude) return { ligado: false, detalhe: v.erro ?? "O serviço local do Windows não responde.", vistoEm: new Date(v.em).toISOString() };
  const s = v.saude;
  const partes = [
    `${s.monitores.length} monitor${s.monitores.length === 1 ? "" : "es"}`,
    `terminais: ${Object.keys(s.shells).join(", ") || "nenhum"}`,
    s.atalho.registrado ? `atalho ${s.atalho.texto}` : `atalho ${s.atalho.texto} NÃO registrado (${s.atalho.erro ?? "erro"})`,
  ];
  if (!s.dpi.por_monitor_v2) partes.push("sem DPI por monitor: cliques podem sair deslocados");
  return { ligado: true, versao: s.versao, detalhe: partes.join(" · "), vistoEm: new Date(v.em).toISOString() };
}

let instalado = false;

/** Uma vez, no boot do processo vivo. */
export function instalarMaos(): void {
  if (instalado) return;
  instalado = true;
  registrarEspelho(espelhoDasMaos);
  registrarEstadoDasMaos({ estado: estadoDasMaosAgora });
  registrarBloco("pastas");
  registrarBloco("apps_ocultos");
  registrarBloco("comandos");
}

const tratados = new Map<string, number>();

/**
 * O que as mãos avisaram. Idempotente pelo id: o mesmo aviso chega pela
 * chamada direta E pelo /health (quando a direta falhou e depois voltou).
 */
export async function tratarAvisoDasMaos(a: AvisoDasMaos): Promise<{ tratado: boolean; motivo?: string }> {
  if (tratados.has(a.id)) return { tratado: false, motivo: "já tratado" };
  tratados.set(a.id, Date.now());
  if (tratados.size > 300) for (const k of [...tratados.keys()].slice(0, 100)) tratados.delete(k);

  const dono = await getOwnerId();
  if (!dono) return { tratado: false, motivo: "esta Órbita ainda não tem dono" };
  if (a.tipo === "parar") {
    const { pararTudo } = await import("../controle/parar");
    await pararTudo(dono, `maos:${a.origem}`.slice(0, 60));
    return { tratado: true };
  }
  const { sessaoAtual, pausarSessao } = await import("../controle/sessao");
  const s = await sessaoAtual(dono);
  if (!s || (a.sessaoId && s.id !== a.sessaoId)) return { tratado: false, motivo: "não há sessão ativa com esse id" };
  await pausarSessao(dono, s.id, (a.motivo || "o dono mexeu no computador").slice(0, 120));
  return { tratado: true };
}

/** Uma volta do laço `maos`. */
export async function voltaDoLacoMaos(): Promise<void> {
  if (!tokenDasMaos()) {
    await atualizarSaude();
    return;
  }
  const v = await atualizarSaude();
  if (v.estado !== "up" || !v.saude) return;
  const cfg = await settings.getMany(["controle.atalhoParar", "computador.appsOcultos"]);
  if (hashDaConfig(cfg["controle.atalhoParar"], cfg["computador.appsOcultos"]) !== v.saude.config_hash) {
    await chamarMaos("/config", { metodo: "PUT", corpo: { atalhoParar: cfg["controle.atalhoParar"], appsOcultos: cfg["computador.appsOcultos"] } }).catch((e) =>
      log.warn("maos.config_falhou", { erro: e instanceof Error ? e.message : String(e) }),
    );
  }
  const pendentes = v.saude.avisos ?? [];
  if (!pendentes.length) return;
  const feitos: string[] = [];
  for (const a of pendentes) {
    try {
      await tratarAvisoDasMaos(a);
      feitos.push(a.id);
    } catch (e) {
      log.warn("maos.aviso_falhou", { tipo: a.tipo, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  if (feitos.length) await chamarMaos("/avisos/confirmar", { corpo: { ids: feitos } }).catch(() => undefined);
}

/** Só para testes. */
export function _reiniciarServico(): void {
  instalado = false;
  tratados.clear();
}
