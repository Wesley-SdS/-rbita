/**
 * Esqueleto de rota: o que o Next mostra ENQUANTO a tela seguinte renderiza.
 *
 * Existe por um motivo de navegação, não de enfeite. Toda tela sob `/app` é
 * rota dinâmica (o layout lê a sessão, que depende do cookie), e para rota
 * dinâmica o Next só faz prefetch se houver um limite de carregamento. Sem
 * este arquivo, o prefetch era simplesmente pulado: cada clique no menu
 * esperava a ida e volta inteira ao servidor com a tela em branco.
 *
 * Com ele, a navegação é imediata e interrompível, e este esqueleto já vem
 * prefetchado junto com a casca.
 *
 * O formato imita o `TituloDaVista` de propósito: o salto entre o esqueleto e
 * a tela pronta fica pequeno, em vez de a página inteira pular de lugar.
 */
export default function Carregando() {
  return (
    <section className="view" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando a tela</span>
      <div className="view-heading" aria-hidden>
        <div className="esqueleto-titulo">
          <i style={{ width: "22%", height: 11 }} />
          <i style={{ width: "46%", height: 34 }} />
          <i style={{ width: "62%", height: 14 }} />
        </div>
      </div>
      <div className="panel esqueleto" style={{ height: 96 }} aria-hidden />
      <div className="panel esqueleto" style={{ height: 220, marginTop: 14 }} aria-hidden />
    </section>
  );
}
