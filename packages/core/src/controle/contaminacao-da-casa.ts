import { settings } from "../settings";
import { criarContaminacao, type Contaminacao } from "./contaminacao";

/**
 * A contaminação por turno com a config do dono (`controle.contaminacaoPorTurno`
 * e `controle.contaminacaoJanelaSeg`, lidas por chamada com o cache curto das
 * settings: mudou na tela, vale em segundos). Sem conseguir ler a config, fica
 * LIGADA com a janela padrão: falha fechada.
 */
export const contaminacaoDaCasa: Contaminacao = criarContaminacao(async () => {
  let c: { "controle.contaminacaoPorTurno"?: boolean; "controle.contaminacaoJanelaSeg"?: number } | null = null;
  try {
    c = await settings.getMany(["controle.contaminacaoPorTurno", "controle.contaminacaoJanelaSeg"]);
  } catch {
    c = null;
  }
  return { ligada: c?.["controle.contaminacaoPorTurno"] ?? true, janelaMs: (c?.["controle.contaminacaoJanelaSeg"] ?? 180) * 1000 };
});
