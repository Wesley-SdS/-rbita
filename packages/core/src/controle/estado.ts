import { log } from "../observability/logger";

/**
 * O ESTADO DAS MÃOS para a tela "Controle do PC" (PRD F7): o `apps/maos` e a
 * extensão do Chrome, cada um ligado ou desligado, com versão.
 *
 * Quem sabe o estado é quem fala com elas: o cliente do `apps/maos` (frente A,
 * que guarda o último `/health` em memória no laço `maos`) e o gateway da
 * extensão (frente B, que sabe se o WebSocket está aberto). Cada um registra
 * um provedor no boot. Sem provedor, o estado é "desligado", com o motivo
 * dito: a tela nunca mostra um "ligado" que ninguém confirmou.
 *
 * BLOCOS: as sub-telas que dependem de cada frente (sites, pastas, apps
 * ocultos, comandos de leitura, pareamento da extensão) só aparecem quando a
 * frente que as serve registra o bloco aqui (`registrarBloco`). A tela recebe a
 * lista em `GET /api/controle/estado` e desenha o componente do mesmo id
 * (`apps/web/src/components/controle/blocos.tsx`); bloco sem backend não
 * aparece, em vez de aparecer quebrado.
 */

export interface EstadoDeMao {
  ligado: boolean;
  versao?: string | null;
  /** por que está desligado, ou o detalhe do que está ligado ("2 monitores", "Chrome 141") */
  detalhe?: string | null;
  /** quando o estado foi visto pela última vez (ISO) */
  vistoEm?: string | null;
}

/** Contrato do `apps/maos`: implementado pelo cliente dele (frente A). */
export interface EstadoDasMaos {
  estado(): EstadoDeMao | Promise<EstadoDeMao>;
}
/** Contrato da extensão: implementado pelo gateway WebSocket dela (frente B). */
export interface EstadoDaExtensao {
  estado(): EstadoDeMao | Promise<EstadoDeMao>;
}

const provedores: { maos: EstadoDasMaos | null; extensao: EstadoDaExtensao | null } = { maos: null, extensao: null };

export function registrarEstadoDasMaos(p: EstadoDasMaos | null): void {
  provedores.maos = p;
}
export function registrarEstadoDaExtensao(p: EstadoDaExtensao | null): void {
  provedores.extensao = p;
}

const DESLIGADO = {
  maos: { ligado: false, detalhe: "O serviço local do Windows (apps/maos) não está instalado nesta Órbita." },
  extensao: { ligado: false, detalhe: "A extensão do Chrome não está instalada nesta Órbita." },
} as const;

async function ler(qual: "maos" | "extensao"): Promise<EstadoDeMao> {
  const p = provedores[qual];
  if (!p) return { ...DESLIGADO[qual] };
  try {
    const e = await p.estado();
    return { ligado: e.ligado === true, versao: e.versao ?? null, detalhe: e.detalhe ?? null, vistoEm: e.vistoEm ?? null };
  } catch (err) {
    log.warn("controle.estado_falhou", { qual, erro: err instanceof Error ? err.message : String(err) });
    return { ligado: false, detalhe: "Não consegui ler o estado agora." };
  }
}

export async function estadoDasMaos(): Promise<{ maos: EstadoDeMao; extensao: EstadoDeMao }> {
  const [maos, extensao] = await Promise.all([ler("maos"), ler("extensao")]);
  return { maos, extensao };
}

/**
 * Sub-telas conhecidas. Uma frente que serve uma delas a registra; a tela só
 * desenha o que estiver registrado. Id novo entra aqui e no mapa da tela.
 */
export const BLOCOS_DA_TELA = ["pareamento", "sites", "pastas", "apps_ocultos", "comandos"] as const;
export type BlocoDaTela = (typeof BLOCOS_DA_TELA)[number];

const blocos = new Set<BlocoDaTela>();

export function registrarBloco(id: BlocoDaTela): void {
  blocos.add(id);
}
export function blocosRegistrados(): BlocoDaTela[] {
  return BLOCOS_DA_TELA.filter((b) => blocos.has(b));
}

/** Só para testes. */
export function _limparEstado(): void {
  provedores.maos = null;
  provedores.extensao = null;
  blocos.clear();
}
