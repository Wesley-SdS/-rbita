"use client";

import { useRef, useState } from "react";
import { invalidar, mutarRecurso, useRecurso } from "@/lib/dados/recurso";
import { ErrorRetry } from "@/components/ui";
import { Icone } from "@/components/presenca/icones";

interface Todo {
  id: string;
  text: string;
  done: boolean;
  dueDate: string | null;
  imageUrl: string | null;
  notes: string | null;
  paraQuem: string | null;
  origemTipo: string | null;
  origemTitulo: string | null;
  origemTrecho: string | null;
}

/** O que está sendo editado agora. Fora do `dado` porque é estado de tela, não de servidor. */
interface Rascunho {
  text: string;
  dueDate: string;
  notes: string;
  paraQuem: string;
  imageUrl: string | null;
}

const soData = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Vence hoje ou já venceu: é a única diferença que muda o que a pessoa faz agora. */
function atraso(iso: string | null, done: boolean): "vencida" | "hoje" | null {
  if (!iso || done) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < hoje.getTime()) return "vencida";
  if (d.getTime() === hoje.getTime()) return "hoje";
  return null;
}

export function TodoPanel() {
  // As tarefas aparecem em quatro lugares do app (aqui, na Visão geral, na
  // busca e no resumo do dia). Pelo cache, é uma leitura só.
  const { dado, erro: erroCarga, recarregar } = useRecurso<{ todos: Todo[] }>("/api/todos");
  const todos = dado?.todos ?? [];
  const [text, setText] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [mostrarFeitas, setMostrarFeitas] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);

  // Falha de leitura e falha de ação são coisas diferentes: a primeira tem um
  // botão de tentar de novo, a segunda é só um aviso sobre o que não salvou.
  const err = erroAcao ?? (todos.length === 0 ? erroCarga : null);
  const setErr = setErroAcao;

  const pendentes = todos.filter((t) => !t.done);
  const feitas = todos.filter((t) => t.done);
  const visiveis = mostrarFeitas ? todos : pendentes;

  async function add() {
    if (!text.trim() && !image) return;
    setErr(null);
    try {
      await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim() || "(imagem)",
          imageUrl: image ?? undefined,
          dueDate: vencimento || undefined,
        }),
      });
      setText("");
      setImage(null);
      setVencimento("");
      invalidar("/api/todos");
    } catch {
      setErr("Não consegui adicionar.");
    }
  }

  // Otimista: reflete na hora e volta atrás se a API falhar. Vale para TODA
  // tela que mostra tarefas, não só para a cópia local deste painel.
  async function toggle(t: Todo) {
    setErr(null);
    const r = await mutarRecurso<{ todos: Todo[] }>({
      chave: "/api/todos",
      otimista: (atual) => ({ todos: (atual?.todos ?? []).map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }),
      // só `done`: mandar o resto aqui apagaria vencimento e anotação de quem
      // marcou a tarefa como feita
      executar: () =>
        fetch("/api/todos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: t.id, done: !t.done }),
        }),
    });
    if (!r.ok) setErr("Não consegui atualizar a tarefa.");
  }

  async function remove(id: string) {
    setErr(null);
    if (editando === id) fecharEdicao();
    const r = await mutarRecurso<{ todos: Todo[] }>({
      chave: "/api/todos",
      otimista: (atual) => ({ todos: (atual?.todos ?? []).filter((x) => x.id !== id) }),
      executar: () => fetch(`/api/todos?id=${id}`, { method: "DELETE" }),
    });
    if (!r.ok) setErr("Não consegui remover.");
  }

  function abrirEdicao(t: Todo) {
    setEditando(t.id);
    setRascunho({
      text: t.text,
      dueDate: soData(t.dueDate),
      notes: t.notes ?? "",
      paraQuem: t.paraQuem ?? "",
      imageUrl: t.imageUrl,
    });
  }
  function fecharEdicao() {
    setEditando(null);
    setRascunho(null);
  }

  async function salvar(id: string, r0: Rascunho) {
    if (!r0.text.trim()) return;
    setErr(null);
    const campos = {
      id,
      text: r0.text.trim(),
      // string vazia é o dono limpando o campo, e o servidor entende o null
      dueDate: r0.dueDate || null,
      notes: r0.notes.trim() || null,
      paraQuem: r0.paraQuem.trim() || null,
      imageUrl: r0.imageUrl,
    };
    fecharEdicao();
    const r = await mutarRecurso<{ todos: Todo[] }>({
      chave: "/api/todos",
      otimista: (atual) => ({
        todos: (atual?.todos ?? []).map((x) =>
          x.id === id
            ? { ...x, text: campos.text, dueDate: campos.dueDate, notes: campos.notes, paraQuem: campos.paraQuem, imageUrl: campos.imageUrl }
            : x,
        ),
      }),
      executar: () =>
        fetch("/api/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(campos) }),
    });
    if (!r.ok) setErr("Não consegui salvar a tarefa.");
  }

  function lerImagem(f: File, aplicar: (dataUrl: string) => void) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") aplicar(reader.result);
    };
    reader.readAsDataURL(f);
  }

  return (
    <>
      <div className="section-heading quick-heading" style={{ marginTop: 0 }}>
        <div>
          <h2>O que ainda precisa de você</h2>
          <p className="descricao-secao">
            {pendentes.length === 0
              ? "Nada em aberto. Aproveite."
              : `${pendentes.length} ${pendentes.length === 1 ? "tarefa em aberto" : "tarefas em aberto"}.`}
          </p>
        </div>
        {feitas.length > 0 && (
          <button className={`filter-chip ${mostrarFeitas ? "active" : ""}`} onClick={() => setMostrarFeitas((v) => !v)}>
            {mostrarFeitas ? "Esconder concluídas" : `Ver ${feitas.length} concluída${feitas.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      <article className="panel">
        <div className="linha-fato">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) lerImagem(f, setImage);
              e.target.value = "";
            }}
          />
          <button
            className={`icon-button ${image ? "com-anexo" : ""}`}
            onClick={() => fileRef.current?.click()}
            aria-label="Anexar imagem à tarefa"
            title={image ? "Imagem anexada" : "Anexar uma imagem"}
          >
            <Icone nome={image ? "check" : "file"} />
          </button>
          <input
            className="inline-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="O que precisa ser feito?"
            maxLength={300}
          />
          <input
            className="inline-input compacto tarefa-data"
            type="date"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            aria-label="Para quando"
            title="Para quando"
          />
          <button className="button primary compacto" onClick={add} disabled={!text.trim() && !image}>
            <Icone nome="plus" />
            Adicionar
          </button>
        </div>

        {err && (
          <ErrorRetry
            message={err}
            onRetry={() => {
              setErr(null);
              recarregar();
            }}
          />
        )}

        {visiveis.length === 0 ? (
          <div className="empty-state">Nenhuma tarefa por aqui.</div>
        ) : (
          visiveis.map((t) => {
            const quando = atraso(t.dueDate, t.done);
            const rasc = editando === t.id ? rascunho : null;
            return (
              <div key={t.id} className={`list-row tarefa ${t.done ? "feita" : ""} ${rasc ? "em-edicao" : ""}`}>
                <button
                  className="icon-button"
                  onClick={() => toggle(t)}
                  aria-label={t.done ? `Reabrir ${t.text}` : `Concluir ${t.text}`}
                  title={t.done ? "Reabrir" : "Concluir"}
                >
                  <Icone nome={t.done ? "check" : "clock"} />
                </button>

                {rasc ? (
                  <div className="tarefa-edicao">
                    <input
                      className="inline-input"
                      value={rasc.text}
                      onChange={(e) => setRascunho({ ...rasc, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void salvar(t.id, rasc);
                        }
                        if (e.key === "Escape") fecharEdicao();
                      }}
                      maxLength={500}
                      autoFocus
                      aria-label="Texto da tarefa"
                    />
                    <div className="tarefa-edicao-linha">
                      <input
                        className="inline-input compacto"
                        type="date"
                        value={rasc.dueDate}
                        onChange={(e) => setRascunho({ ...rasc, dueDate: e.target.value })}
                        aria-label="Para quando"
                      />
                      <input
                        className="inline-input compacto"
                        value={rasc.paraQuem}
                        onChange={(e) => setRascunho({ ...rasc, paraQuem: e.target.value })}
                        placeholder="Para quem?"
                        maxLength={200}
                        aria-label="Para quem"
                      />
                    </div>
                    <textarea
                      className="inline-input"
                      value={rasc.notes}
                      onChange={(e) => setRascunho({ ...rasc, notes: e.target.value })}
                      placeholder="Anotações: o detalhe que não cabe no título"
                      maxLength={5000}
                      aria-label="Anotações"
                    />
                    <input
                      ref={editFileRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) lerImagem(f, (u) => setRascunho((r) => (r ? { ...r, imageUrl: u } : r)));
                        e.target.value = "";
                      }}
                    />
                    {rasc.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={rasc.imageUrl} alt="" className="tarefa-imagem grande" />
                    )}
                    <div className="tarefa-edicao-acoes">
                      <button className="button secondary compacto" onClick={() => editFileRef.current?.click()}>
                        <Icone nome="file" />
                        {rasc.imageUrl ? "Trocar imagem" : "Anexar imagem"}
                      </button>
                      {rasc.imageUrl && (
                        <button className="button secondary compacto" onClick={() => setRascunho({ ...rasc, imageUrl: null })}>
                          Tirar a imagem
                        </button>
                      )}
                      <span className="tarefa-espacador" />
                      <button className="button secondary compacto" onClick={fecharEdicao}>
                        Cancelar
                      </button>
                      <button className="button primary compacto" onClick={() => void salvar(t.id, rasc)} disabled={!rasc.text.trim()}>
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {t.imageUrl && <img src={t.imageUrl} alt="" className="tarefa-imagem" />}
                    <div>
                      <strong>{t.text}</strong>
                      <div className="tarefa-meta">
                        {t.dueDate && (
                          <span className={`tag ${quando === "vencida" ? "orange-tag" : ""}`}>
                            {quando === "hoje" ? "hoje" : quando === "vencida" ? `venceu ${diaMes(t.dueDate)}` : `para ${diaMes(t.dueDate)}`}
                          </span>
                        )}
                        {t.paraQuem && <span className="tag">para {t.paraQuem}</span>}
                        {t.origemTipo && (
                          <span className="tag purple-tag">
                            {t.origemTipo === "reuniao" ? "da reunião" : t.origemTipo === "documento" ? "do documento" : "da conversa"}
                            {t.origemTitulo ? `: ${t.origemTitulo}` : ""}
                          </span>
                        )}
                      </div>
                      {/* o porquê da tarefa fica visível, não escondido num title */}
                      {t.origemTrecho && <small className="tarefa-porque">{t.origemTrecho}</small>}
                      {t.notes && <small className="tarefa-anotacao">{t.notes}</small>}
                    </div>
                    <button className="icon-button" onClick={() => abrirEdicao(t)} aria-label={`Editar ${t.text}`} title="Editar">
                      <Icone nome="edit" />
                    </button>
                    <button className="icon-button" onClick={() => remove(t.id)} aria-label={`Remover ${t.text}`} title="Remover">
                      <Icone nome="trash" />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </article>
    </>
  );
}
