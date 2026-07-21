import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator, Modal, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { Orb, type OrbMode } from "@/components/Orb";
import { streamChat, fetchConversations, fetchConversationMessages, deleteConversation, type ConversationSummary } from "@/lib/chat";
import { getSession, signOut } from "@/lib/auth";
import { startRecording, stopRecordingAndTranscribe, speak, stopSpeaking } from "@/lib/voice";
import { theme } from "@/lib/theme";

interface Msg { role: "user" | "assistant"; content: string }

const STATUS: Record<OrbMode, string> = {
  standby: 'toque no microfone e fale', thinking: "processando…", speaking: "respondendo…",
  listening: "ouvindo…", searching: "pesquisando…", connecting: "conectando…",
};

export default function Chat() {
  const { width, height } = useWindowDimensions();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<OrbMode>("standby");
  const [recording, setRecording] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [focus, setFocus] = useState(true);       // ABRE no modo foco (voz-primeiro)
  const [inputOpen, setInputOpen] = useState(false); // campo de texto escondido até tocar no ⌨
  const [historyOpen, setHistoryOpen] = useState(false);
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const convId = useRef<string | undefined>(undefined);
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generating = mode === "thinking" || mode === "speaking" || mode === "searching";
  const modelKey = "auto"; // no celular a Órbita escolhe o modelo (voz-primeiro); ajustes finos ficam no web

  const orbSize = Math.min(width * 0.82, height * 0.42, 340);
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";

  useEffect(() => { getSession().then((u) => { if (!u) router.replace("/"); }); }, []);

  async function openHistory() {
    setHistoryOpen(true); setLoadingConvs(true);
    try { setConvs(await fetchConversations()); } catch { /* vazio */ } finally { setLoadingConvs(false); }
  }
  async function openConversation(id: string) {
    setHistoryOpen(false);
    if (mode !== "standby") return;
    setMode("thinking");
    try {
      const msgs = await fetchConversationMessages(id);
      setMessages(msgs); convId.current = id;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    } catch { /* ignora */ } finally { setMode("standby"); }
  }
  function newConversation() { setHistoryOpen(false); convId.current = undefined; setMessages([]); }
  async function removeConversation(id: string) {
    if (await deleteConversation(id)) { setConvs((c) => c.filter((x) => x.id !== id)); if (convId.current === id) newConversation(); }
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || mode !== "standby") return;
    setInput(""); setInputOpen(false);
    setMessages((m) => [...m, { role: "user", content }, { role: "assistant", content: "" }]);
    setMode("thinking");
    const ac = new AbortController();
    abortRef.current = ac;
    let reply = "";
    let ok = false;
    try {
      const { conversationId } = await streamChat(content, modelKey, convId.current, (full) => {
        // durante o stream ainda é "processando"; o "respondendo" só vale quando a voz começa
        reply = full;
        setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: full }; return c; });
        scrollRef.current?.scrollToEnd({ animated: true });
      }, ac.signal);
      if (conversationId) convId.current = conversationId;
      ok = true;
    } catch (e) {
      // parada intencional (⏹) mantém o texto parcial; erro real mostra aviso
      const aborted = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
      if (!aborted) setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: "⚠ Falha ao conectar ao servidor." }; return c; });
      else setMessages((m) => { const c = [...m]; if (c[c.length - 1]?.role === "assistant" && !c[c.length - 1]?.content) c.pop(); return c; });
    } finally { abortRef.current = null; }

    // Fala fora do try: uma falha do TTS não pode virar "erro ao conectar".
    // O Orb fica em "respondendo…" só enquanto o áudio realmente toca (onStart/onEnd).
    if (ok && voiceOn && reply) {
      speak(reply, { onStart: () => setMode("speaking"), onEnd: () => setMode("standby") }).catch(() => setMode("standby"));
    } else {
      setMode("standby");
    }
  }

  /** Para a geração em andamento (aborta o stream e cala a fala). */
  function stopGenerating() { abortRef.current?.abort(); void stopSpeaking(); setMode("standby"); }

  async function toggleMic() {
    if (recording) {
      setRecording(false); setMode("thinking");
      try { const text = await stopRecordingAndTranscribe(); setMode("standby"); if (text) void send(text); }
      catch { setMode("standby"); }
      return;
    }
    if (mode !== "standby") return;
    try { await startRecording(); setRecording(true); setMode("listening"); }
    catch { setMode("standby"); }
  }

  // ── controles sutis reaproveitados nas duas visões ──
  const IconBtn = ({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) => (
    <Pressable onPress={onPress} hitSlop={10} style={[styles.icon, active && styles.iconActive]}>
      <Text style={[styles.iconTxt, active && { color: theme.gold, opacity: 1 }]}>{label}</Text>
    </Pressable>
  );

  const HistorySheet = (
    <Modal visible={historyOpen} animationType="slide" transparent onRequestClose={() => setHistoryOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setHistoryOpen(false)}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Conversas</Text>
            <Pressable onPress={newConversation}><Text style={styles.newChat}>＋ Nova</Text></Pressable>
          </View>
          {loadingConvs ? <ActivityIndicator color={theme.gold} style={{ marginTop: 24 }} />
            : convs.length === 0 ? <Text style={styles.empty}>Nenhuma conversa ainda.</Text>
            : (
              <ScrollView style={{ maxHeight: 420 }}>
                {convs.map((c) => (
                  <View key={c.id} style={[styles.convRow, convId.current === c.id && styles.convRowActive]}>
                    <Pressable style={{ flex: 1 }} onPress={() => openConversation(c.id)}>
                      <Text style={styles.convTitle} numberOfLines={1}>{c.title || "Sem título"}</Text>
                      <Text style={styles.convMeta}>{new Date(c.updatedAt).toLocaleString("pt-BR")}</Text>
                    </Pressable>
                    <Pressable onPress={() => removeConversation(c.id)} hitSlop={8}><Text style={styles.convDelete}>🗑</Text></Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
        </Pressable>
      </Pressable>
    </Modal>
  );

  // campo de texto expansível (compartilhado)
  const Composer = (
    <View style={styles.composer}>
      <TextInput
        style={styles.input} placeholder="Escreva para a Órbita…" placeholderTextColor={theme.inkDim}
        value={input} onChangeText={setInput} onSubmitEditing={() => send()} returnKeyType="send" autoFocus multiline
      />
      <Pressable style={styles.sendBtn} onPress={() => send()} disabled={mode !== "standby"}>
        {mode !== "standby" ? <ActivityIndicator color={theme.onGold} /> : <Text style={styles.sendText}>➤</Text>}
      </Pressable>
    </View>
  );

  // ══════════════ MODO FOCO (padrão) ══════════════
  if (focus) {
    return (
      <SafeAreaView style={styles.focusWrap}>
        <Stack.Screen options={{ headerShown: false }} />
        {HistorySheet}

        {/* topo: controles sutis */}
        <View style={styles.topBar}>
          <IconBtn label="☰" onPress={openHistory} />
          <View style={{ flexDirection: "row", gap: 6 }}>
            <IconBtn label={voiceOn ? "🔊" : "🔇"} onPress={() => setVoiceOn((v) => !v)} active={voiceOn} />
            <IconBtn label="⤢" onPress={() => setFocus(false)} />
          </View>
        </View>

        {/* centro: Orb + status + última resposta (sutil) */}
        <View style={styles.center}>
          <Orb mode={mode} size={orbSize} />
          <Text style={styles.wordmark}>ÓRBITA</Text>
          <Text style={styles.status}>{STATUS[mode]}</Text>
          {!!lastReply && (
            <ScrollView style={{ maxHeight: height * 0.2, marginTop: 16 }} contentContainerStyle={{ paddingHorizontal: 8 }}>
              <Text style={styles.reply}>{lastReply}</Text>
            </ScrollView>
          )}
        </View>

        {/* baixo: microfone grande (primário) + teclado sutil */}
        <View style={styles.focusBottom}>
          <IconBtn label="⌨" onPress={() => setInputOpen((v) => !v)} active={inputOpen} />
          <Pressable onPress={generating ? stopGenerating : toggleMic}
            style={[styles.bigMic, (recording || generating) && { backgroundColor: theme.danger }]}>
            <Text style={styles.bigMicTxt}>{recording || generating ? "⏹" : "🎙️"}</Text>
          </Pressable>
          <View style={{ width: 44 }} />
        </View>

        {inputOpen && (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>{Composer}</KeyboardAvoidingView>
        )}
      </SafeAreaView>
    );
  }

  // ══════════════ FORA DO FOCO (transcrição limpa) ══════════════
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      {HistorySheet}
      <SafeAreaView edges={["top"]}>
        <View style={styles.normalTop}>
          <IconBtn label="☰" onPress={openHistory} />
          <View style={styles.orbMini}><Orb mode={mode} size={40} /><Text style={styles.statusMini}>{STATUS[mode]}</Text></View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <IconBtn label={voiceOn ? "🔊" : "🔇"} onPress={() => setVoiceOn((v) => !v)} active={voiceOn} />
            <IconBtn label="⛶" onPress={() => setFocus(true)} />
          </View>
        </View>
      </SafeAreaView>

      <ScrollView ref={scrollRef} style={styles.log} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {messages.length === 0 && <Text style={styles.empty}>Toque em ⛶ para o modo foco, ou escreva abaixo.</Text>}
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === "user" ? styles.user : styles.assistant]}>
            <Text style={m.role === "user" ? styles.userText : styles.assistantText}>
              {m.content || (mode !== "standby" && i === messages.length - 1 ? "…" : "")}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput style={styles.input} placeholder="Escreva para a Órbita…" placeholderTextColor={theme.inkDim}
          value={input} onChangeText={setInput} onSubmitEditing={() => send()} returnKeyType="send" multiline />
        <Pressable onPress={generating ? stopGenerating : toggleMic} style={[styles.icon, styles.iconLg, (recording || generating) && { backgroundColor: theme.danger }]}>
          <Text style={{ fontSize: 18 }}>{recording || generating ? "⏹" : "🎙️"}</Text>
        </Pressable>
        <Pressable style={styles.sendBtn} onPress={() => send()} disabled={mode !== "standby"}>
          {mode !== "standby" ? <ActivityIndicator color={theme.onGold} /> : <Text style={styles.sendText}>➤</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // fundo = cor real do canvas do Orb → Orb funde no fundo (sem retângulo)
  focusWrap: { flex: 1, backgroundColor: "#080502" },
  container: { flex: 1, backgroundColor: "#080502" },

  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  wordmark: { color: "#ffd79a", fontSize: 26, fontWeight: "700", letterSpacing: 8, marginTop: 4 },
  status: { color: theme.inkDim, fontSize: 13, marginTop: 8, textTransform: "lowercase" },
  reply: { color: theme.ink, fontSize: 15, lineHeight: 22, textAlign: "center" },

  focusBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 28, paddingBottom: 8 },
  bigMic: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.gold, alignItems: "center", justifyContent: "center", shadowColor: theme.gold, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  bigMicTxt: { fontSize: 30 },

  // ícones sutis (baixa opacidade até ativos)
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  iconLg: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
  iconActive: { backgroundColor: "rgba(245,181,68,0.12)" },
  iconTxt: { fontSize: 18, color: theme.inkDim, opacity: 0.7 },

  normalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6 },
  orbMini: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusMini: { color: theme.inkDim, fontSize: 12 },

  log: { flex: 1 },
  empty: { color: theme.inkDim, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  bubble: { padding: 12, borderRadius: 14, maxWidth: "85%" },
  user: { backgroundColor: theme.gold, alignSelf: "flex-end" },
  assistant: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, alignSelf: "flex-start" },
  userText: { color: theme.onGold },
  assistantText: { color: theme.ink },

  composer: { flexDirection: "row", gap: 8, padding: 12, alignItems: "flex-end" },
  input: { flex: 1, borderWidth: 1, borderColor: theme.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, color: theme.ink, backgroundColor: theme.surface, maxHeight: 120 },
  sendBtn: { backgroundColor: theme.gold, borderRadius: 14, width: 48, height: 44, alignItems: "center", justifyContent: "center" },
  sendText: { color: theme.onGold, fontSize: 18, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, borderTopWidth: 1, borderColor: theme.line },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { color: theme.ink, fontSize: 16, fontWeight: "700" },
  newChat: { color: theme.gold, fontSize: 14, fontWeight: "600" },
  convRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.line },
  convRowActive: { backgroundColor: theme.ground, borderRadius: 10, paddingHorizontal: 8 },
  convTitle: { color: theme.ink, fontSize: 14 },
  convMeta: { color: theme.inkDim, fontSize: 11, marginTop: 2 },
  convDelete: { fontSize: 16 },
});
