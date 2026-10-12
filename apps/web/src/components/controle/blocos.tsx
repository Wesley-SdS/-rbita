"use client";

import type { ComponentType } from "react";
import type { BlocoDaTela } from "@orbita/core/controle/estado";
import { NavegadorPareamento } from "./navegador-pareamento";
import { NavegadorSites } from "./navegador-sites";
import { MaosPastas } from "./maos-pastas";
import { MaosAppsOcultos } from "./maos-apps-ocultos";
import { MaosComandos } from "./maos-comandos";

/**
 * PONTOS DE MONTAGEM da tela "Controle do PC" (PRD F7).
 *
 * Cada frente que serve uma sub-tela faz DUAS coisas:
 *   1. no servidor, chama `registrarBloco("<id>")` (`packages/core/src/controle/estado.ts`)
 *      quando o backend dela existe (rotas prontas, tudo com OwnerGuard);
 *   2. aqui, acrescenta o componente no mapa abaixo, com o mesmo id.
 *
 * A tela desenha só o que estiver nos DOIS lados: bloco sem backend não
 * aparece (nada de botão que leva a uma rota que não existe), e backend sem
 * componente também não. Ids conhecidos: `BLOCOS_DA_TELA`.
 *
 *   pareamento    frente B: parear a extensão (código de 6 dígitos) e revogar o token
 *   sites         frente B: o modo de cada site (bloqueado, leitura, escrita)
 *   pastas        frente A: as pastas liberadas para terminal e arquivos
 *   apps_ocultos  frente A: os apps que nunca saem na captura
 *   comandos      frente A: a lista de comandos de leitura do terminal
 *
 * Nada disto tem tool, e nunca vai ter: permissão só muda pela tela (PRD §2.3).
 */
export const BLOCOS: Partial<Record<BlocoDaTela, { titulo: string; Componente: ComponentType }>> = {
  pareamento: { titulo: "Extensão do Chrome", Componente: NavegadorPareamento },
  sites: { titulo: "Sites e roteiros do Chrome", Componente: NavegadorSites },
  pastas: { titulo: "Pastas do terminal e dos arquivos", Componente: MaosPastas },
  apps_ocultos: { titulo: "Apps que a Órbita nunca vê", Componente: MaosAppsOcultos },
  comandos: { titulo: "Comandos que rodam sem aprovação", Componente: MaosComandos },
};
