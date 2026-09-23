/**
 * As decisões de uma tarefa, sem banco no meio.
 *
 * Separado do `store` porque é a parte que erra em silêncio: data que anda um
 * dia por causa de fuso, e edição que apaga um campo sem ninguém ter pedido.
 * As duas já aconteceram em telas assim, e as duas são invisíveis num teste de
 * rota que só olha o status 200.
 */

/** O que o dono pode mudar numa tarefa. `undefined` é "não mexa"; `null` é "limpe". */
export interface EdicaoDeTarefa {
  texto?: string;
  concluida?: boolean;
  vencimento?: string | null;
  imagemUrl?: string | null;
  anotacoes?: string | null;
  paraQuem?: string | null;
}

/**
 * Interpreta a data que veio da tela.
 *
 * Uma data SEM hora ("2026-10-05") é lida pelo JavaScript como meia-noite em
 * UTC, e no Brasil isso reaparece como dia 4 às 21h: a tarefa marcada para
 * segunda mostra domingo. Por isso data sem hora vira MEIO-DIA local, que é a
 * única leitura que não atravessa a virada do dia em nenhum fuso do país.
 */
export function dataDeVencimento(valor: string | null | undefined): Date | null {
  if (valor === null || valor === undefined) return null;
  const texto = valor.trim();
  if (!texto) return null;

  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (soData) {
    const [, ano, mes, dia] = soData;
    const d = new Date(Number(ano), Number(mes) - 1, Number(dia), 12, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** O que efetivamente vai para o UPDATE. */
export interface CamposParaGravar {
  text?: string;
  done?: boolean;
  dueDate?: Date | null;
  imageUrl?: string | null;
  notes?: string | null;
  paraQuem?: string | null;
  updatedAt: Date;
}

/**
 * Monta o UPDATE a partir do que o dono mandou.
 *
 * A distinção entre ausente e nulo é o ponto todo: marcar uma tarefa como
 * concluída não pode apagar o vencimento dela só porque a tela não reenviou o
 * campo. Campo que não veio fica como está; campo que veio nulo é o dono
 * pedindo para limpar.
 */
export function camposDaEdicao(e: EdicaoDeTarefa, agora = new Date()): CamposParaGravar {
  const campos: CamposParaGravar = { updatedAt: agora };

  if (e.texto !== undefined) campos.text = e.texto.trim();
  if (e.concluida !== undefined) campos.done = e.concluida;
  if (e.vencimento !== undefined) campos.dueDate = dataDeVencimento(e.vencimento);
  if (e.imagemUrl !== undefined) campos.imageUrl = e.imagemUrl || null;
  if (e.anotacoes !== undefined) campos.notes = e.anotacoes?.trim() || null;
  if (e.paraQuem !== undefined) campos.paraQuem = e.paraQuem?.trim() || null;

  return campos;
}

/** Nada além do carimbo de hora significa que o pedido não muda nada. */
export function edicaoVazia(campos: CamposParaGravar): boolean {
  return Object.keys(campos).length <= 1;
}
