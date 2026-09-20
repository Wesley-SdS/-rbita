"use client";

import { useRef, useState } from "react";
import { invalidar, mutarRecurso, useRecurso } from "@/lib/dados/recurso";
import { ErrorRetry } from "@/components/ui";
import { Icone } from "@/components/presenca/icones";

interface Todo { id: string; text: string; done: boolean; dueDate: string | null; imageUrl: string | null }

export function TodoPanel() {
  // Aberto por padrão: com uma tela por assunto, o painel É a página. O
  // recolhido era do tempo em que 24 blocos dividiam o mesmo scroll.
  const [open, setOpen] = useState(true);
  // As tarefas aparecem em quatro lugares do app (aqui, na Visão geral, na
  // busca e no resumo do dia). Pelo cache, é uma leitura só.
  const { dado, erro: erroCarga, recarregar } = useRecurso<{ todos: Todo[] }>("/api/todos");
  const todos = dado?.todos ?? [];
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Falha de leitura e falha de ação são coisas diferentes: a primeira tem um
  // botão de tentar de novo, a segunda é só um aviso sobre o que não salvou.
  const err = erroAcao ?? (todos.length === 0 ? erroCarga : null);
  const setErr = setErroAcao;

  const pendentes = todos.filter((t) => !t.done).length;

  async function add() {
    if (!text.trim() && !image) return;
    setErr(null);
    try {
      await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() || "(imagem)", imageUrl: image ?? undefined }),
      });
      setText(""); setImage(null); invalidar("/api/todos");
    } catch { setErr("Não consegui adicionar."); }
  }
  // Otimista, como já era: reflete na hora e volta atrás se a API falhar. O
  // que muda é que o desfazer agora vale para TODA tela que mostra tarefas,
  // não só para a cópia local deste painel.
  async function toggle(t: Todo) {
    setErr(null);
    const r = await mutarRecurso<{ todos: Todo[] }>({
      chave: "/api/todos",
      otimista: (atual) => ({ todos: (atual?.todos ?? []).map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }),
      executar: () => fetch("/api/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, done: !t.done }) }),
    });
    if (!r.ok) setErr("Não consegui atualizar a tarefa.");
  }
  async function remove(id: string) {
    setErr(null);
    const r = await mutarRecurso<{ todos: Todo[] }>({
      chave: "/api/todos",
      otimista: (atual) => ({ todos: (atual?.todos ?? []).filter((x) => x.id !== id) }),
      executar: () => fetch(`/api/todos?id=${id}`, { method: "DELETE" }),
    });
    if (!r.ok) setErr("Não consegui remover.");
  }
  function pickImage(f: File) {
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  }

  return (
    <>
      <div className="section-heading quick-heading" style={{ marginTop: 0 }}>
        <div>
          <h2>O que ainda precisa de você</h2>
          <p className="descricao-secao">
            {pendentes === 0 ? "Nada em aberto. Aproveite." : `${pendentes} ${pendentes === 1 ? "tarefa em aberto" : "tarefas em aberto"}.`}
          </p>
        </div>
      </div>

      <article className="panel">
        <div className="linha-fato">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = ""; }} />
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
          <button className="button primary compacto" onClick={add} disabled={!text.trim()}>
            <Icone nome="plus" />
            Adicionar
          </button>
        </div>

        {err && <ErrorRetry message={err} onRetry={() => { setErr(null); recarregar(); }} />}

        {todos.length === 0 ? (
          <div className="empty-state">Nenhuma tarefa por aqui.</div>
        ) : (
          todos.map((t) => (
            <div key={t.id} className={`list-row tarefa ${t.done ? "feita" : ""}`}>
              <button
                className="icon-button"
                onClick={() => toggle(t)}
                aria-label={t.done ? `Reabrir ${t.text}` : `Concluir ${t.text}`}
                title={t.done ? "Reabrir" : "Concluir"}
              >
                <Icone nome={t.done ? "check" : "clock"} />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.imageUrl && <img src={t.imageUrl} alt="" className="tarefa-imagem" />}
              <div>
                <strong>{t.text}</strong>
                {t.dueDate && <small>para {t.dueDate.slice(8, 10)}/{t.dueDate.slice(5, 7)}</small>}
              </div>
              <button className="icon-button" onClick={() => remove(t.id)} aria-label={`Remover ${t.text}`} title="Remover">
                <Icone nome="trash" />
              </button>
            </div>
          ))
        )}
      </article>
    </>
  );
}
