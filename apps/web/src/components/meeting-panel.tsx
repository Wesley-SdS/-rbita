"use client";

import { useEffect, useRef, useState } from "react";
import { Card, PanelTitle, Button, Input } from "@/components/ui";
import { ContinuousRecorder, startMeetingCapture, type MeetingCapture } from "@/lib/voice/capture";
import { ContinuousDictation, getRecognitionCtor } from "@/lib/voice/speech";
import type { SttUtterance } from "@orbita/core/stt/types";
import { parsePrazo, type Compromisso } from "@orbita/core/meetings/compromissos";

/** Locutor reconhecido por voz nesta reunião (Onda 9), como o /api/stt devolve junto das utterances. */
interface SpeakerIdentity {
  label: string;
  outcome: "identificado" | "provavel" | "desconhecido";
  personId: string | null;
  name: string | null;
  score: number;
  speechS: number;
  ref: string | null;
  unknownLabel: string | null;
}
interface PersonOption { id: string; name: string }

/** "Locutor A" → nome salvo, no texto e nos rótulos de fala; sem nome, mantém o rótulo. */
function applySpeakerNames(text: string, names: Record<string, string>): string {
  let out = text;
  for (const [tag, name] of Object.entries(names)) {
    if (!name.trim()) continue;
    out = out.replace(new RegExp(`Locutor ${tag}\\b`, "g"), name.trim());
  }
  return out;
}

/**
 * Rótulo sugerido pelo reconhecimento de voz para uma etiqueta: nome quando
 * identificado, "Nome?" (com a confiança no title) quando provável, ou o
 * "Desconhecido N" efêmero. Sem identidade nenhuma, cai no rótulo cru.
 */
function speakerSuggestion(tag: string, identities: SpeakerIdentity[]): { text: string; title?: string } {
  const si = identities.find((s) => s.label === tag);
  if (!si) return { text: `Locutor ${tag}` };
  if (si.outcome === "identificado" && si.name) return { text: si.name };
  if (si.outcome === "provavel" && si.name) return { text: `${si.name}?`, title: `${Math.round(si.score * 100)}% de confiança` };
  return { text: si.unknownLabel ?? `Locutor ${tag}` };
}

/** Nome exibido: o que o usuário salvou manualmente, senão a sugestão do reconhecimento de voz. */
function speakerLabel(tag: string, identities: SpeakerIdentity[], names: Record<string, string>): { text: string; title?: string } {
  const manual = names[tag]?.trim();
  if (manual) return { text: manual };
  return speakerSuggestion(tag, identities);
}

/** Mapa tag→texto da sugestão de voz, para alimentar `applySpeakerNames` no resumo e nos compromissos. */
function autoSpeakerNames(identities: SpeakerIdentity[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const si of identities) out[si.label] = speakerSuggestion(si.label, identities).text;
  return out;
}

/**
 * Transcrição de reunião (caso-âncora do PRD: "Resume essa reunião").
 *
 * Desenho em duas trilhas, e a distinção importa:
 *
 *  • VERDADE   gravação CONTÍNUA do início ao fim → ao encerrar, sobe inteira
 *              para o /api/stt com `diarize` → transcrição com quem falou o quê.
 *  • PRÉVIA    Web Speech no aparelho, só para você ver que está funcionando.
 *              Instantânea, de graça, e sem separar vozes.
 *
 * O fluxo antigo gravava janelas de 8s e transcrevia uma a uma: perdia o áudio
 * entre as janelas e nunca conseguiria separar vozes (os rótulos A/B/C são
 * atribuídos por requisição, então o "A" de uma janela não é o "A" da seguinte).
 */
export function MeetingPanel() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [systemAudio, setSystemAudio] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState("");
  const [utterances, setUtterances] = useState<SttUtterance[]>([]);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "transcrevendo" | "resumindo">("idle");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [compromissos, setCompromissos] = useState<Compromisso[]>([]);
  const [addedTodos, setAddedTodos] = useState<Set<number>>(new Set());
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [savingNames, setSavingNames] = useState(false);
  const [namesSaved, setNamesSaved] = useState(false);
  const [speakerIdentities, setSpeakerIdentities] = useState<SpeakerIdentity[]>([]);
  const [persons, setPersons] = useState<PersonOption[]>([]);
  const [linkPerson, setLinkPerson] = useState<Record<string, string>>({}); // tag -> personId escolhido ("" = nenhum)
  const [useSample, setUseSample] = useState<Record<string, boolean>>({}); // tag -> "usar esta fala como amostra"
  const [amostras, setAmostras] = useState<Record<string, string>>({}); // tag -> resultado do cadastro de amostra

  const captureRef = useRef<MeetingCapture | null>(null);
  const recorderRef = useRef<ContinuousRecorder | null>(null);
  const dictationRef = useRef<ContinuousDictation | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // pessoas cadastradas, para o seletor "vincular a pessoa" ao nomear locutor (fail-soft: sem elas, só falta o vínculo)
  useEffect(() => {
    fetch("/api/home/persons")
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((d) => setPersons((d.people ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))))
      .catch(() => setPersons([]));
  }, []);

  // libera microfone/captura se o componente sair com a reunião rodando
  useEffect(() => {
    return () => {
      dictationRef.current?.stop();
      captureRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function start() {
    setSummary(""); setTranscript(""); setPreview(""); setUtterances([]); setNote(null);
    setDocumentId(null); setCompromissos([]); setAddedTodos(new Set()); setSpeakerNames({}); setNamesSaved(false);
    setSpeakerIdentities([]); setLinkPerson({}); setUseSample({}); setAmostras({});

    let capture: MeetingCapture;
    try {
      capture = await startMeetingCapture({ systemAudio });
    } catch {
      setNote("Sem acesso ao microfone.");
      return;
    }
    captureRef.current = capture;

    if (systemAudio && !capture.hasSystemAudio) {
      // falha silenciosa aqui significaria gravar meia reunião sem ninguém notar
      setNote("Só o microfone foi capturado. Para pegar Teams/Meet, marque “compartilhar áudio” no diálogo do Chrome.");
    }

    const recorder = new ContinuousRecorder();
    recorder.start(capture.stream);
    recorderRef.current = recorder;

    // prévia ao vivo (best-effort — navegador sem Web Speech simplesmente não mostra)
    const Ctor = getRecognitionCtor();
    if (Ctor) {
      const d = new ContinuousDictation(Ctor, { onText: setPreview });
      d.start();
      dictationRef.current = d;
    }

    setActive(true);
    setElapsed(0);
    clearTimer();
    timerRef.current = setInterval(() => setElapsed(Math.floor((recorder.elapsedMs ?? 0) / 1000)), 1000);
  }

  async function stop() {
    setActive(false);
    clearTimer();
    dictationRef.current?.stop();
    dictationRef.current = null;

    const blob = await recorderRef.current?.stop();
    recorderRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;

    if (!blob || blob.size === 0) {
      setNote("Nada foi gravado.");
      return;
    }

    // 1) transcrição da reunião INTEIRA, com separação de vozes
    setPhase("transcrevendo");
    let texto = "";
    try {
      const fd = new FormData();
      fd.append("file", blob, "reuniao.webm");
      fd.append("diarize", "true");
      const r = await fetch("/api/stt", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "falha na transcrição");

      if (d.utterances?.length) {
        setUtterances(d.utterances);
        texto = (d.utterances as SttUtterance[]).map((u) => `Locutor ${u.speaker}: ${u.text}`).join("\n");

        // Onda 9: locutores reconhecidos por voz, se o serviço de percepção respondeu.
        // Pré-vincula o seletor de pessoa à sugestão (identificado ou provável); sem
        // sugestão o seletor começa vazio (não é correção, é vínculo novo).
        const identities: SpeakerIdentity[] = d.speakerIdentities ?? [];
        if (identities.length) {
          setSpeakerIdentities(identities);
          const pre: Record<string, string> = {};
          for (const si of identities) if (si.personId) pre[si.label] = si.personId;
          setLinkPerson(pre);
        }
      } else {
        texto = (d.text ?? "").trim();
        if (d.diarizationUnavailable) {
          setNote(
            d.provider === "whisper-local"
              ? "Transcrito no Whisper local, que não separa vozes. Configure ASSEMBLYAI_API_KEY para ter os locutores."
              : "Só uma voz foi identificada no áudio.",
          );
        }
      }
      setTranscript(texto);
    } catch (e) {
      setPhase("idle");
      setNote(e instanceof Error ? e.message : "Falha ao transcrever.");
      return;
    }

    if (!texto.trim()) {
      setPhase("idle");
      setNote("A transcrição voltou vazia.");
      return;
    }

    // 2) resumo + arquivamento no RAG
    setPhase("resumindo");
    try {
      const r = await fetch("/api/meeting/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: texto }),
      });
      const d = await r.json();
      if (r.ok) {
        setSummary(d.summary + (d.archived ? "\n\n📎 salvo na sua memória." : ""));
        setCompromissos(d.compromissos ?? []);
        setDocumentId(d.documentId ?? null);
      } else {
        setSummary("⚠ " + (d.error ?? "falha ao resumir"));
      }
    } catch {
      setSummary("⚠ falha ao resumir");
    } finally {
      setPhase("idle");
    }
  }

  /** MTG.2: transforma um compromisso extraído da reunião numa tarefa, com um clique. */
  async function addTodo(c: Compromisso, i: number) {
    const prazo = parsePrazo(c.prazo);
    const prazoISO = prazo ? prazo.toISOString() : undefined;
    const texto = `[Reunião] ${c.descricao}${c.responsavel ? ` (${c.responsavel})` : ""}`;
    const r = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: texto, ...(prazoISO ? { dueDate: prazoISO } : {}) }),
    });
    if (r.ok) setAddedTodos((s) => new Set(s).add(i));
  }

  /**
   * B6.5 + Onda 9: nomeia os locutores desta reunião e, quando o dono vinculou
   * uma pessoa cadastrada com "usar como amostra", manda a ligação para o
   * backend cadastrar a fala como amostra de voz dela. `corrigido` avisa
   * quando o dono trocou a sugestão da Órbita por outra pessoa (isso ensina).
   */
  async function saveSpeakerNames() {
    if (!documentId) return;
    setSavingNames(true);
    try {
      const nonEmpty = Object.fromEntries(Object.entries(speakerNames).filter(([, v]) => v.trim()));
      const links: Record<string, { personId: string; ref?: string; usarComoAmostra: boolean; corrigido: boolean }> = {};
      for (const [tag, personId] of Object.entries(linkPerson)) {
        if (!personId) continue;
        const si = speakerIdentities.find((s) => s.label === tag);
        links[tag] = {
          personId,
          ref: si?.ref ?? undefined,
          usarComoAmostra: !!useSample[tag],
          corrigido: !!si?.personId && si.personId !== personId,
        };
      }
      const r = await fetch(`/api/meeting/${documentId}/speakers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakers: nonEmpty, ...(Object.keys(links).length ? { links } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      setNamesSaved(r.ok);
      if (r.ok && d.amostras) setAmostras(d.amostras);
    } finally {
      setSavingNames(false);
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const busy = phase !== "idle";
  const dim = { color: "var(--color-ink-dim)" };
  const boxed = { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" };
  // nome efetivo por etiqueta: o que o dono digitou manualmente, senão a sugestão do reconhecimento de voz
  const effectiveNames = { ...autoSpeakerNames(speakerIdentities), ...speakerNames };

  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <PanelTitle>Reunião</PanelTitle>
        {active && <span className="ml-2 h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--color-danger)" }} />}
        <span className="ml-auto text-xs" style={dim}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {!active && !busy && (
            <label className="flex items-center gap-2 text-[11px]" style={dim}>
              <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
              capturar áudio da tela (Teams, Meet, Slack)
            </label>
          )}

          {!active ? (
            <Button variant="primary" size="md" onClick={start} disabled={busy}>
              {phase === "transcrevendo" ? "transcrevendo e separando vozes…" : phase === "resumindo" ? "resumindo…" : "● iniciar transcrição"}
            </Button>
          ) : (
            <button onClick={stop} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
              ⏹ encerrar e resumir · {mmss}
            </button>
          )}

          {note && (
            <div className="rounded-lg border p-2 text-[11px]" style={{ borderColor: "color-mix(in oklab, var(--color-danger) 40%, var(--color-line))", color: "var(--color-ink-dim)" }}>
              {note}
            </div>
          )}

          {active && (
            <div className="max-h-24 overflow-y-auto rounded-lg border p-2 text-[11px]" style={boxed}>
              <div className="mb-1 text-[10px] uppercase tracking-wide" style={dim}>prévia (só o seu microfone)</div>
              {preview || "ouvindo…"}
            </div>
          )}

          {utterances.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2 text-[11px]" style={boxed}>
              <div className="mb-1 text-[10px] uppercase tracking-wide" style={dim}>
                {new Set(utterances.map((u) => u.speaker)).size} locutores
              </div>
              {utterances.map((u, i) => {
                const lbl = speakerLabel(u.speaker, speakerIdentities, speakerNames);
                return (
                  <p key={i} className="mb-1">
                    <span className="font-semibold" style={{ color: "var(--color-gold)" }} title={lbl.title}>
                      {lbl.text}:
                    </span> {u.text}
                  </p>
                );
              })}
            </div>
          )}

          {!utterances.length && transcript && (
            <div className="max-h-24 overflow-y-auto rounded-lg border p-2 text-[11px]" style={boxed}>{transcript}</div>
          )}

          {phase === "idle" && utterances.length > 0 && (
            <div className="rounded-lg border p-2 text-[11px]" style={boxed}>
              <div className="mb-1 text-[10px] uppercase tracking-wide" style={dim}>quem é quem (só nesta reunião)</div>
              <div className="flex flex-col gap-1.5">
                {[...new Set(utterances.map((u) => u.speaker))].map((tag) => {
                  const suggestion = speakerSuggestion(tag, speakerIdentities);
                  const si = speakerIdentities.find((s) => s.label === tag);
                  return (
                    <div key={tag} className="flex flex-col gap-1 border-b pb-1.5 last:border-0 last:pb-0" style={{ borderColor: "var(--color-line)" }}>
                      <div className="flex items-center gap-2">
                        <span style={dim} title={suggestion.title}>{suggestion.text}</span>
                        <Input
                          size="sm"
                          placeholder="nome"
                          value={speakerNames[tag] ?? ""}
                          onChange={(e) => { setSpeakerNames((s) => ({ ...s, [tag]: e.target.value })); setNamesSaved(false); }}
                        />
                      </div>
                      {persons.length > 0 && (
                        <div className="flex items-center gap-2 pl-1">
                          <select
                            value={linkPerson[tag] ?? ""}
                            onChange={(e) => { setLinkPerson((s) => ({ ...s, [tag]: e.target.value })); setNamesSaved(false); }}
                            className="rounded border px-1.5 py-0.5 text-[11px]"
                            style={{ borderColor: "var(--color-line)", background: "transparent", color: "var(--color-ink)" }}
                          >
                            <option value="">vincular a pessoa cadastrada…</option>
                            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          {linkPerson[tag] && si?.ref && (
                            <label className="flex items-center gap-1" style={dim}>
                              <input
                                type="checkbox"
                                checked={!!useSample[tag]}
                                onChange={(e) => { setUseSample((s) => ({ ...s, [tag]: e.target.checked })); setNamesSaved(false); }}
                              />
                              usar esta fala como amostra de voz
                            </label>
                          )}
                        </div>
                      )}
                      {amostras[tag] && (
                        <span className="pl-1 text-[11px]" style={amostras[tag] === "cadastrada" ? { color: "var(--color-gold)" } : { color: "var(--color-danger)" }}>
                          amostra: {amostras[tag]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                onClick={saveSpeakerNames}
                disabled={savingNames || !documentId}
                className="mt-2 rounded-lg border px-2 py-1 text-[11px] disabled:opacity-50"
                style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
              >
                {savingNames ? "salvando…" : namesSaved ? "✓ nomes salvos" : "salvar nomes"}
              </button>
            </div>
          )}

          {compromissos.length > 0 && (
            <div className="rounded-lg border p-2 text-[11px]" style={boxed}>
              <div className="mb-1 text-[10px] uppercase tracking-wide" style={dim}>compromissos identificados</div>
              <ul className="flex flex-col gap-1">
                {compromissos.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <button
                      onClick={() => addTodo(c, i)}
                      disabled={addedTodos.has(i)}
                      title="adicionar como tarefa"
                      className="mt-0.5 shrink-0 rounded border px-1.5 text-[11px] disabled:opacity-40"
                      style={{ borderColor: "var(--color-line)", color: addedTodos.has(i) ? "var(--color-gold)" : "var(--color-ink-dim)" }}
                    >
                      {addedTodos.has(i) ? "✓" : "+"}
                    </button>
                    <span>
                      {applySpeakerNames(c.descricao, effectiveNames)}
                      {c.responsavel && <span style={dim}> · {applySpeakerNames(c.responsavel, effectiveNames)}</span>}
                      {c.prazo && <span style={dim}> · prazo {c.prazo}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary && (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border p-2 text-[11px]"
              style={{ borderColor: "color-mix(in oklab, var(--color-gold) 40%, var(--color-line))", color: "var(--color-ink)" }}>
              {applySpeakerNames(summary, effectiveNames)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
