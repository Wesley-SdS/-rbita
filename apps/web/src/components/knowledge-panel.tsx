"use client";

import { useEffect, useRef, useState } from "react";
import { Icone } from "@/components/presenca/icones";
import { enfileirar, isJobTerminal, type JobView } from "@/lib/jobs";
import { JobProgress } from "@/components/job-progress";
import { KnowledgeSearch } from "@/components/knowledge-search";

interface Contagens {
  documents: number;
  chunks: number;
  memories: number;
}
interface Acervo {
  documentos: number;
  trechos: number;
  memorias: number;
  semPagina: number;
}
interface Memoria {
  id: string;
  content: string;
}

/**
 * Memória: mais do que guardar, conectar.
 *
 * Indexar e reindexar são trabalhos de fila (gerar embedding de centenas de
 * trechos passa muito de dez segundos), então a tela enfileira e acompanha.
 */
export function KnowledgePanel() {
  const [contagens, setContagens] = useState<Contagens>({ documents: 0, chunks: 0, memories: 0 });
  const [acervo, setAcervo] = useState<Acervo | null>(null);
  const [memorias, setMemorias] = useState<Memoria[]>([]);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [fato, setFato] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [colando, setColando] = useState(false);
  const [trabalhoTexto, setTrabalhoTexto] = useState<JobView | null>(null);
  const [trabalhoArquivo, setTrabalhoArquivo] = useState<JobView | null>(null);
  const [trabalhoReindex, setTrabalhoReindex] = useState<JobView | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const atualizar = () => {
    fetch("/api/knowledge").then((r) => r.json()).then(setContagens).catch(() => {});
    fetch("/api/memory").then((r) => r.json()).then((d) => setMemorias(d.memories ?? [])).catch(() => {});
    fetch("/api/account/reindex").then((r) => r.json()).then(setAcervo).catch(() => {});
  };
  useEffect(atualizar, []);

  function avisar(texto: string, erro = false) {
    setRecado({ texto, erro });
    setTimeout(() => setRecado(null), 7000);
  }

  function aoTerminar(j: JobView, quandoFeito: (resultado: unknown) => string) {
    if (!isJobTerminal(j.status)) return;
    setOcupado(false);
    if (j.status === "feito") {
      avisar(quandoFeito(j.resultado));
      atualizar();
    } else if (j.status === "falhou") {
      avisar(j.erro?.mensagem ?? "Não deu certo.", true);
    } else {
      avisar("Cancelado.");
    }
  }

  async function indexarTexto(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || !texto.trim() || ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titulo, content: texto }),
      });
      setTrabalhoTexto(await enfileirar(r));
      setTitulo("");
      setTexto("");
      setColando(false);
    } catch (err) {
      setOcupado(false);
      avisar(err instanceof Error ? err.message : "Não consegui indexar.", true);
    }
  }

  async function enviarArquivo(f: File) {
    setOcupado(true);
    setTrabalhoArquivo(null);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      setTrabalhoArquivo(await enfileirar(r));
    } catch (err) {
      setOcupado(false);
      avisar(err instanceof Error ? err.message : "Não consegui ler esse arquivo.", true);
    }
  }

  async function guardarFato() {
    if (!fato.trim() || ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fato }),
      });
      if (!r.ok) throw new Error("falha");
      setFato("");
      avisar("Guardado.");
      atualizar();
    } catch {
      avisar("Não consegui guardar.", true);
    } finally {
      setOcupado(false);
    }
  }

  async function esquecer(id: string) {
    await fetch(`/api/memory?id=${id}`, { method: "DELETE" });
    atualizar();
  }

  /* Reindexar refaz os cortes e os vetores do acervo inteiro. É o caminho
     depois de trocar o modelo de embedding, e é o que dá PÁGINA aos documentos
     antigos, indexados quando o corte ainda não guardava a origem do trecho. */
  async function reindexar() {
    if (ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/account/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo: "recortar" }),
      });
      setTrabalhoReindex(await enfileirar(r));
    } catch (err) {
      setOcupado(false);
      avisar(err instanceof Error ? err.message : "Não consegui reindexar.", true);
    }
  }

  return (
    <>
      <input
        ref={arquivoRef}
        type="file"
        accept=".pdf,.txt,.md,image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void enviarArquivo(f);
          e.target.value = "";
        }}
      />

      <div className="stat-grid">
        <article className="panel stat-card">
          <span>Documentos</span>
          <div className="stat-value">{contagens.documents}</div>
          <small>O que a Órbita já leu por inteiro</small>
        </article>
        <article className="panel stat-card">
          <span>Trechos indexados</span>
          <div className="stat-value">{contagens.chunks.toLocaleString("pt-BR")}</div>
          <small>{acervo && acervo.semPagina > 0 ? `${acervo.semPagina} ainda sem página de origem` : "Cada um sabe de onde veio"}</small>
        </article>
        <article className="panel stat-card">
          <span>Memórias</span>
          <div className="stat-value">{contagens.memories}</div>
          <small>Fatos sobre você e seus projetos</small>
        </article>
      </div>

      <article className="panel">
        <div className="section-heading">
          <h2>Encontre uma lembrança</h2>
        </div>
        <p className="description">
          A mesma busca que o chat usa, aberta para você conferir com os próprios olhos: cada
          resultado diz de qual documento e de qual página veio.
        </p>
        <KnowledgeSearch />
      </article>

      <div className="section-heading quick-heading">
        <div>
          <h2>Dar o que lembrar</h2>
          <p className="descricao-secao">Um arquivo, um texto colado ou um fato solto sobre você.</p>
        </div>
        <div className="acoes-secao">
          <button className="button primary compacto" onClick={() => arquivoRef.current?.click()} disabled={ocupado}>
            <Icone nome="file" />
            Enviar arquivo
          </button>
          <button className="button secondary compacto" onClick={() => setColando((v) => !v)}>
            <Icone nome={colando ? "close" : "plus"} />
            {colando ? "Cancelar" : "Colar um texto"}
          </button>
        </div>
      </div>

      {trabalhoArquivo && !isJobTerminal(trabalhoArquivo.status) && (
        <JobProgress
          job={trabalhoArquivo}
          onChange={(j) => {
            setTrabalhoArquivo(j);
            aoTerminar(j, (res) => {
              const d = res as { title: string; chunks: number; duplicado?: boolean; leitura?: { ocr: number; visao: number } } | null;
              if (d?.duplicado) return `${d.title} já estava indexado, não dupliquei.`;
              if (!d) return "Arquivo processado.";
              const lido = d.leitura && d.leitura.ocr + d.leitura.visao > 0 ? ` (${d.leitura.ocr} página(s) por OCR, ${d.leitura.visao} pelo modelo de visão)` : "";
              return `${d.title}: ${d.chunks} trecho(s)${lido}.`;
            });
          }}
        />
      )}

      {colando && (
        <form className="panel" onSubmit={indexarTexto}>
          <span className="eyebrow">UM TEXTO PARA GUARDAR</span>
          <label className="field">
            Título
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={200} placeholder="Do que se trata?" />
          </label>
          <label className="field">
            Conteúdo
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} required rows={6} placeholder="Cole aqui o texto que a Órbita deve poder consultar depois." />
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setColando(false)}>
              Agora não
            </button>
            <button type="submit" className="button primary" disabled={ocupado}>
              <Icone nome="check" />
              Indexar
            </button>
          </div>
        </form>
      )}

      {trabalhoTexto && !isJobTerminal(trabalhoTexto.status) && (
        <JobProgress
          job={trabalhoTexto}
          onChange={(j) => {
            setTrabalhoTexto(j);
            aoTerminar(j, (res) => `${(res as { chunks: number } | null)?.chunks ?? 0} trecho(s) indexado(s).`);
          }}
        />
      )}

      {recado && <div className={recado.erro ? "aviso-erro" : "notice"}>{recado.erro ? <span>{recado.texto}</span> : recado.texto}</div>}

      <div className="two-columns" style={{ marginTop: 22 }}>
        <article className="panel">
          <h2>O que sei sobre você</h2>
          <p className="description">
            Fatos que a Órbita guarda e usa nas respostas. Você pode esquecer qualquer um a qualquer
            momento, e ele sai também das buscas.
          </p>
          <div className="linha-fato">
            <input
              className="inline-input"
              value={fato}
              onChange={(e) => setFato(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void guardarFato();
                }
              }}
              placeholder="Ex.: prefiro reuniões pela manhã"
              maxLength={500}
            />
            <button className="button primary compacto" onClick={guardarFato} disabled={ocupado || !fato.trim()}>
              <Icone nome="plus" />
              Guardar
            </button>
          </div>

          {memorias.length === 0 ? (
            <div className="empty-state">Nada guardado ainda.</div>
          ) : (
            memorias.map((m) => (
              <div key={m.id} className="list-row">
                <span className="quick-icon lavender-bg">
                  <Icone nome="spark" />
                </span>
                <div>
                  <strong>{m.content}</strong>
                </div>
                <button className="icon-button" onClick={() => esquecer(m.id)} aria-label="Esquecer" title="Esquecer">
                  <Icone nome="trash" />
                </button>
              </div>
            ))
          )}
        </article>

        <article className="panel">
          <h2>Manutenção do acervo</h2>
          <p className="description">
            Reindexar refaz os cortes e os vetores de tudo. É o caminho depois de trocar o modelo de
            embedding, e é o que dá página aos documentos antigos.
          </p>
          {acervo && (
            <>
              <div className="stat-row">
                <span>Documentos</span>
                <b>{acervo.documentos}</b>
              </div>
              <div className="stat-row">
                <span>Trechos</span>
                <b>{acervo.trechos.toLocaleString("pt-BR")}</b>
              </div>
              <div className="stat-row">
                <span>Trechos sem página</span>
                <b className={acervo.semPagina > 0 ? "" : "bom"}>{acervo.semPagina}</b>
              </div>
            </>
          )}
          <button className="button secondary full-width" onClick={reindexar} disabled={ocupado} style={{ marginTop: 16 }}>
            <Icone nome="refresh" />
            Reindexar acervo
          </button>
          {trabalhoReindex && !isJobTerminal(trabalhoReindex.status) && (
            <JobProgress
              job={trabalhoReindex}
              onChange={(j) => {
                setTrabalhoReindex(j);
                aoTerminar(j, (res) => {
                  const d = res as { trechos: number; memorias: number } | null;
                  return `${d?.trechos ?? 0} trecho(s) e ${d?.memorias ?? 0} memória(s) reindexados.`;
                });
              }}
            />
          )}
        </article>
      </div>
    </>
  );
}
