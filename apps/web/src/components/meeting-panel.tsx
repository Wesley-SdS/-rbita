"use client";

import { useEffect, useRef, useState } from "react";
import { useRecurso } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";
import { ContinuousRecorder, startMeetingCapture, type MeetingCapture } from "@/lib/voice/capture";
import { ContinuousDictation, getRecognitionCtor } from "@/lib/voice/speech";
import { avaliarGravacao } from "@/lib/voice/gravacao";
import type { SttUtterance } from "@orbita/core/stt/types";
import { parsePrazo, type Compromisso } from "@orbita/core/meetings/compromissos";
import { enfileirar, type JobView } from "@/lib/jobs";
import { JobProgress } from "@/components/job-progress";

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
  const [active, setActive] = useState(false);
  const [systemAudio, setSystemAudio] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState("");
  const [utterances, setUtterances] = useState<SttUtterance[]>([]);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  // O recado da reunião tem TOM. Antes era só texto, e tudo (inclusive
  // "transcrevi no Whisper local") saía na mesma caixa vermelha de erro.
  const [note, setNote] = useState<{ texto: string; atencao?: boolean } | null>(null);
  const avisar = (texto: string, atencao = false) => setNote({ texto, atencao });
  const [phase, setPhase] = useState<"idle" | "transcrevendo" | "resumindo">("idle");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [summarizeJob, setSummarizeJob] = useState<JobView | null>(null);
  const [transcribeJob, setTranscribeJob] = useState<JobView | null>(null);
  const [compromissos, setCompromissos] = useState<Compromisso[]>([]);
  const [addedTodos, setAddedTodos] = useState<Set<number>>(new Set());
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [savingNames, setSavingNames] = useState(false);
  const [namesSaved, setNamesSaved] = useState(false);
  const [speakerIdentities, setSpeakerIdentities] = useState<SpeakerIdentity[]>([]);
  const [linkPerson, setLinkPerson] = useState<Record<string, string>>({}); // tag -> personId escolhido ("" = nenhum)
  const [useSample, setUseSample] = useState<Record<string, boolean>>({}); // tag -> "usar esta fala como amostra"
  const [amostras, setAmostras] = useState<Record<string, string>>({}); // tag -> resultado do cadastro de amostra

  const captureRef = useRef<MeetingCapture | null>(null);
  const recorderRef = useRef<ContinuousRecorder | null>(null);
  const dictationRef = useRef<ContinuousDictation | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pessoas cadastradas, para o seletor "vincular a pessoa" ao nomear locutor
  // (fail-soft: sem elas, só falta o vínculo). É a MESMA lista da tela Casa,
  // então pelo cache isto quase nunca vai à rede.
  const { dado: pessoasResp } = useRecurso<{ people: { id: string; name: string }[] }>("/api/home/persons", { estavel: true });
  const persons = (pessoasResp?.people ?? []).map((p) => ({ id: p.id, name: p.name }));

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
    setDocumentId(null); setSummarizeJob(null); setTranscribeJob(null); setCompromissos([]); setAddedTodos(new Set()); setSpeakerNames({}); setNamesSaved(false);
    setSpeakerIdentities([]); setLinkPerson({}); setUseSample({}); setAmostras({});

    let capture: MeetingCapture;
    try {
      capture = await startMeetingCapture({ systemAudio });
    } catch {
      avisar("Preciso do microfone para ouvir a reunião. Libere o acesso no navegador e comece de novo.", true);
      return;
    }
    captureRef.current = capture;

    if (systemAudio && !capture.hasSystemAudio) {
      // falha silenciosa aqui significaria gravar meia reunião sem ninguém notar
      avisar("Estou ouvindo só pelo microfone. Para pegar o som do Teams ou do Meet, marque “compartilhar áudio” no diálogo do Chrome.");
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

    // Confere ANTES de subir: gravação muda vira trabalho de fila e
    // transcrição paga para voltar vazia (ver lib/voice/gravacao.ts).
    const avaliacao = avaliarGravacao(blob?.size ?? 0, elapsed);
    if (!blob || !avaliacao.vale) {
      avisar(avaliacao.vale ? "Não chegou som nenhum. Confira o microfone e tente de novo." : avaliacao.recado, true);
      return;
    }

    // A reunião vai inteira para a fila: o servidor transcreve (com quem falou)
    // e, havendo texto, ENCADEIA o resumo sozinho. Antes quem encadeava era esta
    // aba, e fechá-la no meio perdia a reunião.
    setPhase("transcrevendo");
    try {
      const fd = new FormData();
      fd.append("file", blob, "reuniao.webm");
      const r = await fetch("/api/meeting/transcribe", { method: "POST", body: fd });
      setTranscribeJob(await enfileirar(r));
    } catch (e) {
      setPhase("idle");
      avisar(e instanceof Error ? e.message : "Não consegui enviar a gravação. Quer tentar de novo?", true);
    }
  }

  /** Transcrição terminou: mostra o texto, pré-vincula locutores e passa a acompanhar o resumo. */
  async function onTranscribeChange(j: JobView) {
    setTranscribeJob(j);
    if (j.status === "falhou") {
      setPhase("idle");
      avisar(j.erro?.mensagem ?? "Não consegui transcrever dessa vez. Quer tentar de novo?", true);
      return;
    }
    if (j.status === "cancelado") {
      setPhase("idle");
      avisar("Transcrição cancelada.");
      return;
    }
    if (j.status !== "feito") return;

    const d = (j.resultado ?? {}) as {
      text?: string;
      utterances?: SttUtterance[];
      speakerIdentities?: SpeakerIdentity[];
      diarizationUnavailable?: boolean;
      provider?: string;
      resumoJobId?: string | null;
    };
    let texto = "";
    if (d.utterances?.length) {
      setUtterances(d.utterances);
      texto = d.utterances.map((u) => `Locutor ${u.speaker}: ${u.text}`).join("\n");
      // Onda 9: locutores reconhecidos por voz, se o serviço de percepção respondeu.
      // Pré-vincula o seletor de pessoa à sugestão (identificado ou provável); sem
      // sugestão o seletor começa vazio (não é correção, é vínculo novo).
      const identities = d.speakerIdentities ?? [];
      if (identities.length) {
        setSpeakerIdentities(identities);
        const pre: Record<string, string> = {};
        for (const si of identities) if (si.personId) pre[si.label] = si.personId;
        setLinkPerson(pre);
      }
    } else {
      texto = (d.text ?? "").trim();
      if (d.diarizationUnavailable) {
        avisar(
          d.provider === "whisper-local"
            ? "Transcrito no Whisper local, que não separa vozes. Configure ASSEMBLYAI_API_KEY para ter os locutores."
            : "Só uma voz foi identificada no áudio.",
        );
      }
    }
    setTranscript(texto);

    if (!texto.trim() || !d.resumoJobId) {
      setPhase("idle");
      if (!texto.trim()) avisar("Ouvi a gravação, mas não encontrei fala nenhuma nela. Confira o microfone escolhido no navegador e tente de novo.", true);
      return;
    }

    // o resumo já foi enfileirado pelo servidor: só passa a acompanhar
    setPhase("resumindo");
    try {
      const r = await fetch(`/api/jobs/${d.resumoJobId}`);
      const v = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((v as { error?: string }).error ?? "Não consegui acompanhar o resumo.");
      setSummarizeJob(v as JobView);
    } catch (e) {
      setSummary("Não consegui resumir: " + (e instanceof Error ? e.message : "falha desconhecida"));
      setPhase("idle");
    }
  }

  /** Resultado do resumo, quando o trabalho de fila termina (status feito/falhou/cancelado). */
  function onSummarizeChange(j: JobView) {
    setSummarizeJob(j);
    if (j.status === "feito") {
      const d = j.resultado as { summary: string; compromissos?: Compromisso[]; documentId?: string | null; archived?: boolean } | null;
      if (d) {
        setSummary(d.summary + (d.archived ? "\n\nGuardado na sua memória." : ""));
        setCompromissos(d.compromissos ?? []);
        setDocumentId(d.documentId ?? null);
      }
      setPhase("idle");
    } else if (j.status === "falhou") {
      setSummary("Não consegui resumir: " + (j.erro?.mensagem ?? "falha desconhecida"));
      setPhase("idle");
    } else if (j.status === "cancelado") {
      setSummary("Resumo cancelado.");
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

  const locutores = [...new Set(utterances.map((u) => u.speaker))];

  return (
    <>
      <div className="two-columns">
        <article className="panel meeting-live">
          <span className={`tag ${active ? "green" : ""}`}>{active ? "GRAVANDO" : "PRONTA PARA OUVIR"}</span>
          <span className="eyebrow">O QUE FOR DITO VIRA PRÓXIMO PASSO</span>
          <h2>{active ? "Estou com você nessa conversa." : "Uma escuta atenta."}</h2>
          <p>
            {active
              ? "Pode falar normalmente. No fim eu separo as vozes, resumo e tiro os compromissos."
              : "A Órbita ouve, transcreve, separa quem falou o quê e devolve decisões e próximos passos."}
          </p>

          {/* A onda é ilustrativa e assume o ritmo quando está gravando: ela
              existe para dizer "estou ouvindo", não para medir o áudio. */}
          <div className={`waveform ${active ? "running" : ""}`} aria-hidden="true">
            {Array.from({ length: 40 }, (_, i) => (
              <i
                key={i}
                style={{ "--h": `${12 + Math.sin(i * 0.7) ** 2 * 45}px`, "--delay": `${i * -0.09}s` } as React.CSSProperties}
              />
            ))}
          </div>

          <p className="meeting-tempo">{active ? mmss : "00:00"}</p>

          {!active ? (
            <>
              <button className="button primary" onClick={start} disabled={busy}>
                <Icone nome="mic" />
                {phase === "transcrevendo"
                  ? "Transcrevendo e separando vozes…"
                  : phase === "resumindo"
                    ? "Resumindo…"
                    : "Começar a ouvir"}
              </button>
              {!busy && (
                <label className="switch-row">
                  <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
                  <span>
                    <Icone nome="volume" />
                    Capturar também o áudio da tela (Teams, Meet, Slack)
                  </span>
                </label>
              )}
            </>
          ) : (
            <button className="button danger" onClick={stop}>
              <Icone nome="stop" />
              Encerrar e resumir
            </button>
          )}

          {note && (
            <div className={`aviso-ameno ${note.atencao ? "atencao" : ""}`} style={{ marginTop: 14 }}>
              <span>{note.texto}</span>
            </div>
          )}

          {phase === "transcrevendo" && transcribeJob && (
            <>
              <JobProgress job={transcribeJob} onChange={(j) => void onTranscribeChange(j)} />
              <p className="nota-fila">
                Pode fechar esta aba: a reunião continua sendo processada e aparece em Preferências, na
                aba Trabalhos.
              </p>
            </>
          )}
          {phase === "resumindo" && summarizeJob && <JobProgress job={summarizeJob} onChange={onSummarizeChange} />}
        </article>

        <article className="panel">
          <div className="section-heading">
            <h2>Palavras que ficam</h2>
            {locutores.length > 0 && (
              <span className="tag">
                {locutores.length} {locutores.length === 1 ? "voz" : "vozes"}
              </span>
            )}
          </div>

          <div className="transcript">
            {active && (
              <div className="transcript-row">
                <strong>Prévia · só o seu microfone</strong>
                {preview || "ouvindo…"}
              </div>
            )}
            {utterances.map((u, i) => {
              const lbl = speakerLabel(u.speaker, speakerIdentities, speakerNames);
              return (
                <div key={i} className="transcript-row">
                  <strong title={lbl.title}>{lbl.text}</strong>
                  {u.text}
                </div>
              );
            })}
            {!utterances.length && !active && transcript && <div className="transcript-row">{transcript}</div>}
            {!utterances.length && !active && !transcript && (
              <div className="empty-state">Comece a ouvir para ver a conversa virar contexto.</div>
            )}
          </div>
        </article>
      </div>

      {phase === "idle" && locutores.length > 0 && (
        <article className="panel" style={{ marginTop: 22 }}>
          <div className="section-heading">
            <h2>Quem é quem</h2>
            <span className="tag">só nesta reunião</span>
          </div>
          <p className="description">
            Dar nome a cada voz melhora o resumo e deixa os compromissos com responsável. Vincular a uma
            pessoa cadastrada faz a Órbita reconhecer essa voz nas próximas conversas.
          </p>

          {locutores.map((tag) => {
            const sugestao = speakerSuggestion(tag, speakerIdentities);
            const si = speakerIdentities.find((x) => x.label === tag);
            return (
              <div key={tag} className="locutor">
                <div className="locutor-linha">
                  <span className="tag" title={sugestao.title}>
                    {sugestao.text}
                  </span>
                  <input
                    className="inline-input compacto"
                    placeholder="Como se chama?"
                    value={speakerNames[tag] ?? ""}
                    onChange={(e) => {
                      setSpeakerNames((x) => ({ ...x, [tag]: e.target.value }));
                      setNamesSaved(false);
                    }}
                  />
                </div>
                {persons.length > 0 && (
                  <div className="locutor-linha">
                    <select
                      className="inline-input compacto"
                      value={linkPerson[tag] ?? ""}
                      onChange={(e) => {
                        setLinkPerson((x) => ({ ...x, [tag]: e.target.value }));
                        setNamesSaved(false);
                      }}
                    >
                      <option value="">Vincular a uma pessoa cadastrada…</option>
                      {persons.map((pessoa) => (
                        <option key={pessoa.id} value={pessoa.id}>
                          {pessoa.name}
                        </option>
                      ))}
                    </select>
                    {linkPerson[tag] && si?.ref && (
                      <label className="switch-row" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={!!useSample[tag]}
                          onChange={(e) => {
                            setUseSample((x) => ({ ...x, [tag]: e.target.checked }));
                            setNamesSaved(false);
                          }}
                        />
                        <span>Usar esta fala como amostra de voz</span>
                      </label>
                    )}
                  </div>
                )}
                {amostras[tag] && (
                  <span className={`tag ${amostras[tag] === "cadastrada" ? "green" : ""}`}>amostra: {amostras[tag]}</span>
                )}
              </div>
            );
          })}

          <button
            className="button secondary"
            onClick={saveSpeakerNames}
            disabled={savingNames || !documentId}
            style={{ marginTop: 16 }}
          >
            <Icone nome="check" />
            {savingNames ? "Guardando…" : namesSaved ? "Nomes guardados" : "Guardar os nomes"}
          </button>
        </article>
      )}

      {compromissos.length > 0 && (
        <article className="panel" style={{ marginTop: 22 }}>
          <div className="section-heading">
            <h2>O que ficou combinado</h2>
            <span className="tag green">{compromissos.length}</span>
          </div>
          <p className="description">Cada um pode virar tarefa com um toque, para não se perder depois.</p>
          {compromissos.map((c, i) => (
            <div key={i} className="list-row">
              <button
                className="icon-button"
                onClick={() => addTodo(c, i)}
                disabled={addedTodos.has(i)}
                aria-label="Adicionar como tarefa"
                title={addedTodos.has(i) ? "Já virou tarefa" : "Adicionar como tarefa"}
              >
                <Icone nome={addedTodos.has(i) ? "check" : "plus"} />
              </button>
              <div>
                <strong>{applySpeakerNames(c.descricao, effectiveNames)}</strong>
                <small>
                  {c.responsavel ? applySpeakerNames(c.responsavel, effectiveNames) : "sem responsável"}
                  {c.prazo ? ` · prazo ${c.prazo}` : ""}
                </small>
              </div>
            </div>
          ))}
        </article>
      )}

      {summary && (
        <article className="panel meeting-summary" style={{ marginTop: 22 }}>
          <span className="tag green">RESUMO</span>
          <h2 style={{ marginTop: 14 }}>O que essa conversa deixou</h2>
          <p className="resumo-texto">{applySpeakerNames(summary, effectiveNames)}</p>
        </article>
      )}
    </>
  );
}
