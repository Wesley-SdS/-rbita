import { latestEventWithSnapshot } from "./query";
import { settings } from "../settings";
import type { CameraEvent } from "@orbita/db/camera-schema";

/**
 * Rótulos que o NAVEGADOR usa ao publicar um quadro, e que o servidor precisa
 * reconhecer. Ficam aqui, e não só no front, porque é o servidor que decide
 * quanto tempo o quadro vale.
 */
export const ROTULO_SOB_DEMANDA = "sob demanda";
export const ROTULO_APARELHO = "aparelho";

/**
 * Este quadro existe porque ALGUÉM PEDIU, ou porque o mundo aconteceu?
 *
 * A diferença é o que conserta um bug medido em 27/09/2026. O dono pediu cinco
 * vezes, em 92 segundos, para a Órbita olhar a câmera do notebook no modo de
 * voz. O banco mostra UM `camera_event` (01:55:08) e CINCO chamadas de visão
 * depois dele: a mesma foto descrita cinco vezes. A cada pergunta a Órbita
 * achava que já tinha uma imagem de "agora" e nunca pedia quadro novo.
 *
 * Depois da correção, o mesmo teste gravou TRÊS eventos com md5 diferentes para
 * três perguntas. É o md5 que prova, não a contagem de tokens: imagem do mesmo
 * tamanho com o mesmo prompt dá a mesma contagem de entrada mesmo sendo outra
 * foto.
 *
 * O quadro que a própria Órbita mandou capturar não é notícia do mundo, é o
 * retrato do instante em que ela perguntou, e ele envelhece na hora. Já um
 * evento empurrado por um detector (Frigate: "person", "motion") É a notícia, e
 * continua valendo pela janela longa: encurtá-la para ele significaria "não
 * consigo ver" numa câmera que o navegador nem tem como fotografar.
 */
export function pediramEsteQuadro(label: string): boolean {
  return label === ROTULO_SOB_DEMANDA || label === ROTULO_APARELHO;
}

/**
 * Este quadro ainda conta como "agora"? Puro.
 *
 * A idade é calculada aqui, e não importada de `query`, para esta regra não
 * depender do módulo que fala com o banco: ela é a decisão, e decisão se testa
 * sem banco. O piso em zero é de propósito, porque a captura vem do NAVEGADOR e
 * o relógio dele pode estar à frente do servidor: idade negativa viraria
 * "vencido" num quadro que acabou de chegar.
 */
export function aindaEhAgora(quando: Date, janelaSegundos: number, agora = new Date()): boolean {
  const idade = Math.max(0, (agora.getTime() - quando.getTime()) / 1000);
  return idade <= janelaSegundos;
}

/** Por quantos segundos este quadro ainda conta como "agora". Puro. */
export function janelaDoQuadro(label: string, janelaPadrao: number, janelaPedida: number): number {
  return pediramEsteQuadro(label) ? janelaPedida : janelaPadrao;
}

const PADROES = { "cameras.imagemFrescaSegundos": 120, "cameras.imagemFrescaPedidaSegundos": 10 };

/**
 * A última imagem da câmera, desde que ela ainda valha como "agora".
 *
 * As janelas são config do dono e não constante daqui: o que conta como recente
 * muda com o uso. Uma câmera de portão pode responder por uma imagem de dois
 * minutos; "o que estou segurando" não.
 *
 * Falha na leitura da config cai nos defaults e NÃO bloqueia: ficar sem imagem
 * por causa da configuração seria pior do que usar a janela padrão.
 */
export async function imagemFresca(cameraId: string): Promise<CameraEvent | null> {
  const cfg = await settings.getMany(["cameras.imagemFrescaSegundos", "cameras.imagemFrescaPedidaSegundos"]).catch(() => PADROES);
  // sem janela na consulta: qual janela vale depende do rótulo DO EVENTO, que
  // só se conhece depois de lê-lo (e a comparação de idade sempre foi em JS,
  // então não há ida extra ao banco)
  const ev = await latestEventWithSnapshot(cameraId);
  if (!ev) return null;
  const janela = janelaDoQuadro(ev.label, cfg["cameras.imagemFrescaSegundos"], cfg["cameras.imagemFrescaPedidaSegundos"]);
  return aindaEhAgora(ev.createdAt, janela) ? ev : null;
}
