"use client";

import { useEffect, useRef, useState } from "react";
import { Card, PanelTitle, Input, Button, ErrorRetry } from "@/components/ui";

interface Todo { id: string; text: string; done: boolean; dueDate: string | null; imageUrl: string | null }

export function TodoPanel() {
  const [open, setOpen] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    fetch("/api/todos").then((r) => r.json()).then((d) => setTodos(d.todos ?? [])).catch(() => setErr("Falha ao carregar tarefas."));
  }
  useEffect(load, []);

  const pending = todos.filter((t) => !t.done).length;

  async function add() {
    if (!text.trim() && !image) return;
    setErr(null);
    try {
      await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() || "(imagem)", imageUrl: image ?? undefined }),
      });
      setText(""); setImage(null); load();
    } catch { setErr("Não consegui adicionar."); }
  }
  // otimista: reflete o toggle na hora e reverte se a API falhar (sem piscar a lista).
  async function toggle(t: Todo) {
    setErr(null);
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    try {
      const r = await fetch("/api/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, done: !t.done }) });
      if (!r.ok) throw new Error();
    } catch {
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: t.done } : x))); // rollback
      setErr("Não consegui atualizar a tarefa.");
    }
  }
  async function remove(id: string) {
    setErr(null);
    const snapshot = todos;
    setTodos((prev) => prev.filter((x) => x.id !== id)); // otimista
    try {
      const r = await fetch(`/api/todos?id=${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
    } catch {
      setTodos(snapshot); // rollback
      setErr("Não consegui remover.");
    }
  }
  function pickImage(f: File) {
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  }

  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <PanelTitle>Tarefas</PanelTitle>
        {pending > 0 && <span className="ml-2 rounded-full px-1.5 text-[10px] font-bold" style={{ background: "var(--color-gold)", color: "#241403" }}>{pending}</span>}
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>

      <div className="mt-2 flex flex-col gap-1">
        {todos.slice(0, open ? 20 : 4).map((t) => (
          <div key={t.id} className="flex items-center gap-1.5 text-[11px]" style={{ opacity: t.done ? 0.5 : 1 }}>
            <button onClick={() => toggle(t)} aria-label={t.done ? "marcar como pendente" : "concluir tarefa"}>{t.done ? "☑" : "☐"}</button>
            {t.imageUrl && <img src={t.imageUrl} alt="" className="h-5 w-5 rounded object-cover" />}
            <span className="flex-1 truncate" style={{ color: "var(--color-ink)", textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
            {t.dueDate && <span style={{ color: "var(--color-ink-dim)" }}>{t.dueDate.slice(5, 10)}</span>}
            <button onClick={() => remove(t.id)} aria-label="remover tarefa" style={{ color: "var(--color-danger)" }}>×</button>
          </div>
        ))}
        {todos.length === 0 && <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>nenhuma tarefa</span>}
        {err && <ErrorRetry message={err} onRetry={() => { setErr(null); load(); }} />}
      </div>

      {open && (
        <div className="mt-2 flex items-center gap-1">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} title="anexar imagem" className="rounded border px-1.5 py-1 text-xs" style={{ borderColor: image ? "var(--color-gold)" : "var(--color-line)", color: image ? "var(--color-gold)" : "var(--color-ink-dim)" }}>📎</button>
          <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Nova tarefa…" className="flex-1" />
          <Button variant="primary" size="sm" onClick={add}>+</Button>
        </div>
      )}
    </Card>
  );
}
