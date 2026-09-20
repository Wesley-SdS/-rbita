"use client";

import { useEffect, useRef, useState } from "react";
import { Card, PanelTitle, Input, Textarea, Button, ErrorRetry } from "@/components/ui";
import { useVisivel } from "@/lib/use-visible";

/**
 * Acompanhar tarefa passo a passo pela câmera ("me ajuda com essa receita",
 * PRD §5.4). A Órbita guarda os passos, olha a câmera do cômodo de tempos em
 * tempos e avisa o próximo passo. Uma tarefa ativa por vez; "parar" fica em
 * destaque porque é câmera olhando o cômodo, não um detalhe de UI.
 */
type GuidedStatus = "ativa" | "concluida" | "cancelada" | "expirada";
interface GuidedView {
  id: string; titulo: string; passos: string[]; passoAtual: number; status: GuidedStatus;
  comodo: string | null; camera: string | null; intervaloSegundos: number;
  ultimaOlhada: string | null; ultimaObservacao: string | null; expiraEm: string;
}
interface CameraOption { id: string; name: string; roomId: string | null; enabled: boolean }
interface Room { id: string; name: string }

const dim = { color: "var(--color-ink-dim)" } as const;
const gold = { color: "var(--color-gold)" } as const;
const danger = { color: "var(--color-danger)" } as const;

const STATUS_LABEL: Record<GuidedStatus, string> = {
  ativa: "em andamento",
  concluida: "concluída",
  cancelada: "cancelada",
  expirada: "expirada por tempo",
};

function fmtHora(iso: string): string {
  try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

export function GuidedPanel() {
  const [tarefas, setTarefas] = useState<GuidedView[] | null>(null);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visivel = useVisivel();
  useEffect(() => {
    // fora da tela ou com a aba escondida não consulta; ao voltar, atualiza na hora
    if (!visivel) return;
    let alive = true;
    setErr(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    Promise.all([
      fetch("/api/guided").then((r) => (r.ok ? r.json() : Promise.reject(r))),
      fetch("/api/cameras").then((r) => (r.ok ? r.json() : { cameras: [] })).catch(() => ({ cameras: [] })),
      fetch("/api/home/rooms").then((r) => (r.ok ? r.json() : { rooms: [] })).catch(() => ({ rooms: [] })),
    ])
      .then(([g, c, r]) => {
        if (!alive) return;
        const lista: GuidedView[] = g.tarefas ?? [];
        setTarefas(lista);
        setCameras(c.cameras ?? []);
        setRooms(r.rooms ?? []);
        // só continua perguntando enquanto houver tarefa ativa: a própria
        // tarefa diz de quanto em quanto tempo a câmera é olhada
        const ativa = lista.find((t) => t.status === "ativa");
        if (ativa) timerRef.current = setTimeout(() => { if (alive) setReload((n) => n + 1); }, Math.max(1, ativa.intervaloSegundos) * 1000);
      })
      .catch(async (r) => {
        if (!alive) return;
        const d = r instanceof Response ? await r.json().catch(() => ({})) : {};
        setErr((d as { error?: string }).error ?? "Não foi possível carregar o acompanhamento.");
        setTarefas([]);
      });
    return () => { alive = false; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [reload, visivel]);

  function refresh() { setReload((n) => n + 1); }

  if (err) return <Card><PanelTitle className="mb-2">Acompanhar tarefa</PanelTitle><ErrorRetry message={err} onRetry={refresh} /></Card>;

  const ativa = tarefas?.find((t) => t.status === "ativa") ?? null;
  const historico = (tarefas ?? []).filter((t) => t.status !== "ativa").slice(0, 5);

  return (
    <Card>
      <PanelTitle className="mb-2">Acompanhar tarefa</PanelTitle>
      <p className="mb-3 text-[15px]" style={dim}>
        A Órbita guarda os passos, olha a câmera do cômodo de tempos em tempos e avisa o próximo
        passo quando achar que o atual terminou.
      </p>

      {!tarefas ? (
        <p className="text-[15px]" style={dim}>Carregando…</p>
      ) : ativa ? (
        <ActiveTask task={ativa} onChanged={refresh} />
      ) : starting ? (
        <StartForm cameras={cameras} rooms={rooms} onCancel={() => setStarting(false)} onStarted={() => { setStarting(false); refresh(); }} />
      ) : (
        <Button size="sm" variant="outline" onClick={() => setStarting(true)}>+ acompanhar uma tarefa</Button>
      )}

      {historico.length > 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--color-line)" }}>
          <p className="mb-1 text-[14px] font-medium">Últimas tarefas</p>
          <div className="flex flex-col gap-0.5 text-[14px]" style={dim}>
            {historico.map((t) => (
              <div key={t.id}>{t.titulo} · {STATUS_LABEL[t.status]}</div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function ActiveTask({ task, onChanged }: { task: GuidedView; onChanged: () => void }) {
  const [busy, setBusy] = useState<"anterior" | "proximo" | "parar" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function irPara(passo: number) {
    setBusy(passo < task.passoAtual ? "anterior" : "proximo");
    setMsg(null);
    const r = await fetch("/api/guided", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, passo }),
    }).catch(() => null);
    setBusy(null);
    if (!r?.ok) {
      const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
      setMsg(d?.error ?? "Não foi possível mudar de passo.");
      return;
    }
    onChanged();
  }

  async function parar() {
    setBusy("parar");
    setMsg(null);
    const r = await fetch(`/api/guided?id=${task.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!r?.ok) {
      const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
      setMsg(d?.error ?? "Não foi possível encerrar o acompanhamento.");
      return;
    }
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2 text-[15px]">
      <div>
        <p className="font-medium">{task.titulo}</p>
        <p className="text-[14px]" style={dim}>
          {task.camera ?? "câmera"}{task.comodo ? ` · ${task.comodo}` : ""} · expira em {fmtHora(task.expiraEm)}
        </p>
      </div>

      <ol className="flex flex-col gap-1">
        {task.passos.map((p, i) => (
          <li
            key={i}
            className="flex items-baseline gap-2"
            style={i === task.passoAtual ? gold : i < task.passoAtual ? { color: "var(--color-ink-dim)", textDecoration: "line-through" } : dim}
          >
            <span className="passo-numero">{i + 1}.</span>
            <span>{p}</span>
          </li>
        ))}
      </ol>

      <div className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
        <p className="text-[13px] uppercase tracking-wide" style={dim}>o que a câmera achou que viu</p>
        {task.ultimaObservacao ? (
          <>
            <p className="mt-1">{task.ultimaObservacao}</p>
            <p className="mt-1 text-[13px]" style={dim}>
              não é verdade absoluta, é a leitura do modelo de visão{task.ultimaOlhada ? ` · ${fmtHora(task.ultimaOlhada)}` : ""}
            </p>
          </>
        ) : (
          <p className="mt-1" style={dim}>Ainda sem observação da câmera.</p>
        )}
      </div>

      {msg && <p style={danger}>{msg}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void irPara(task.passoAtual - 1)}
          disabled={busy !== null || task.passoAtual === 0}
          className="rounded-lg border px-2 py-1 disabled:opacity-40"
          style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
        >
          {busy === "anterior" ? "…" : "◂ passo anterior"}
        </button>
        <button
          onClick={() => void irPara(task.passoAtual + 1)}
          disabled={busy !== null}
          className="rounded-lg border px-2 py-1 disabled:opacity-40"
          style={{ borderColor: "var(--color-gold)", color: "var(--color-gold)" }}
        >
          {busy === "proximo" ? "…" : task.passoAtual + 1 >= task.passos.length ? "concluir" : "próximo passo ▸"}
        </button>
        <Button size="sm" variant="danger" onClick={() => void parar()} disabled={busy !== null}>
          {busy === "parar" ? "parando…" : "■ parar acompanhamento"}
        </Button>
      </div>
    </div>
  );
}

function StartForm({ cameras, rooms, onCancel, onStarted }: {
  cameras: CameraOption[]; rooms: Room[]; onCancel: () => void; onStarted: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [passosTexto, setPassosTexto] = useState("");
  const [comodo, setComodo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const opcoes = cameras
    .filter((c) => c.enabled)
    .map((c) => ({ valor: c.name, rotulo: `${c.name} · ${rooms.find((r) => r.id === c.roomId)?.name ?? "sem cômodo"}` }));

  async function submit() {
    const passos = passosTexto.split("\n").map((p) => p.trim()).filter(Boolean);
    if (!titulo.trim()) { setMsg("Título é obrigatório."); return; }
    if (!passos.length) { setMsg("Descreva ao menos um passo, um por linha."); return; }
    if (!comodo) { setMsg("Escolha a câmera que vai olhar."); return; }
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/guided", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo: titulo.trim(), passos, comodo }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!r?.ok) { setMsg(d?.error ?? "Não foi possível começar o acompanhamento."); return; }
    onStarted();
  }

  return (
    <div className="flex flex-col gap-2 text-[15px]">
      <Input placeholder="título da tarefa (ex.: fazer o bolo de cenoura)" value={titulo} disabled={busy} onChange={(e) => setTitulo(e.target.value)} />
      <Textarea
        placeholder={"um passo por linha, ex.:\nseparar os ingredientes\nbater no liquidificador\nlevar ao forno"}
        value={passosTexto}
        disabled={busy}
        onChange={(e) => setPassosTexto(e.target.value)}
        rows={4}
      />
      <select
        value={comodo}
        disabled={busy}
        onChange={(e) => setComodo(e.target.value)}
        className="rounded-lg border px-2 py-1"
        style={{ borderColor: "var(--color-line)", background: "transparent", color: "var(--color-ink)" }}
      >
        <option value="">câmera que vai olhar</option>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {!opcoes.length && <p className="text-[14px]" style={dim}>Nenhuma câmera ligada. Ligue uma em Câmeras antes de começar.</p>}
      {msg && <p style={danger}>{msg}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void submit()}>começar</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>cancelar</Button>
      </div>
    </div>
  );
}
