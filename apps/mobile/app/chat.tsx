import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
} from "react-native";
import { router, Stack } from "expo-router";
import { Orb, type OrbMode } from "@/components/Orb";
import { streamChat, fetchModels, fetchConversations, fetchConversationMessages, deleteConversation, type ConversationSummary } from "@/lib/chat";
import { getSession, signOut } from "@/lib/auth";
import { startRecording, stopRecordingAndTranscribe, speak } from "@/lib/voice";
import { theme } from "@/lib/theme";

interface Msg { role: "user" | "assistant"; content: string }

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<OrbMode>("standby");
  const [modelKey, setModelKey] = useState("local/qwen2.5:7b");
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [recording, setRecording] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const convId = useRef<string | undefined>(undefined);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    getSession().then((u) => { if (!u) router.replace("/"); });
    fetchModels().then(({ models, defaultModel }) => { setModels(models); setModelKey(defaultModel); }).catch(() => {});
  }, []);

  async function openHistory() {
    setHistoryOpen(true);
    setLoadingConvs(true);
    try { setConvs(await fetchConversations()); } catch { /* segue vazio */ } finally { setLoadingConvs(false); }
  }

  async function openConversation(id: string) {
    setHistoryOpen(false);
    if (mode !== "standby") return;
    setMode("thinking");
    try {
      const msgs = await fetchConversationMessages(id);
      setMessages(msgs);
      convId.current = id;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    } catch { /* ignora */ } finally { setMode("standby"); }
  }

  function newConversation() {
    setHistoryOpen(false);
    convId.current = undefined;
    setMessages([]);
  }

  async function removeConversation(id: string) {
    const ok = await deleteConversation(id);
    if (ok) {
      setConvs((c) => c.filter((x) => x.id !== id));
      if (convId.current === id) newConversation();
    }
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || mode !== "standby") return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content }, { role: "assistant", content: "" }]);
    setMode("thinking");
    let reply = "";
    try {
      const { conversationId } = await streamChat(content, modelKey, convId.current, (full) => {
        reply = full;
        setMode("speaking");
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { role: "assistant", content: full };
          return c;
        });
        scrollRef.current?.scrollToEnd({ animated: true });
      });
      if (conversationId) convId.current = conversationId;
      if (voiceOn && reply) void speak(reply); // fala a resposta (paridade com o web)
    } catch {
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = { role: "assistant", content: "⚠ Falha ao conectar ao servidor." };
        return c;
      });
    } finally {
      setMode("standby");
    }
  }

  /** Gravar por voz: toca no mic → grava → para → transcreve (STT) → envia. */
  async function toggleMic() {
    if (recording) {
      setRecording(false);
      setMode("thinking");
      try {
        const text = await stopRecordingAndTranscribe();
        setMode("standby");
        if (text) void send(text);
      } catch {
        setMode("standby");
      }
      return;
    }
    if (mode !== "standby") return;
    try {
      await startRecording();
      setRecording(true);
      setMode("listening");
    } catch {
      setMode("standby");
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{
        headerLeft: () => (
          <View style={{ flexDirection: "row", gap: 14 }}>
            <Pressable onPress={openHistory}><Text style={styles.headerBtn}>☰</Text></Pressable>
            <Pressable onPress={newConversation}><Text style={styles.headerBtn}>＋</Text></Pressable>
          </View>
        ),
        headerRight: () => (
          <Pressable onPress={async () => { await signOut(); router.replace("/"); }}>
            <Text style={styles.logout}>Sair</Text>
          </Pressable>
        ),
      }} />

      <Modal visible={historyOpen} animationType="slide" transparent onRequestClose={() => setHistoryOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setHistoryOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Conversas</Text>
              <Pressable onPress={newConversation}><Text style={styles.newChat}>＋ Nova</Text></Pressable>
            </View>
            {loadingConvs ? (
              <ActivityIndicator color={theme.gold} style={{ marginTop: 24 }} />
            ) : convs.length === 0 ? (
              <Text style={styles.empty}>Nenhuma conversa ainda.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 420 }}>
                {convs.map((c) => (
                  <View key={c.id} style={[styles.convRow, convId.current === c.id && styles.convRowActive]}>
                    <Pressable style={{ flex: 1 }} onPress={() => openConversation(c.id)}>
                      <Text style={styles.convTitle} numberOfLines={1}>{c.title || "Sem título"}</Text>
                      <Text style={styles.convMeta}>{new Date(c.updatedAt).toLocaleString("pt-BR")}</Text>
                    </Pressable>
                    <Pressable onPress={() => removeConversation(c.id)} hitSlop={8}>
                      <Text style={styles.convDelete}>🗑</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.orbBar}>
        <Orb mode={mode} size={72} />
        <View style={{ flex: 1 }}>
          <Text style={styles.status}>
            {mode === "standby" ? "em espera" : mode === "thinking" ? "pensando…" : mode === "speaking" ? "respondendo…" : "ouvindo…"}
          </Text>
          {/* seletor de modelo: toca para alternar entre os modelos disponíveis */}
          <Pressable
            onPress={() => {
              if (models.length < 2) return;
              const i = models.findIndex((m) => m.key === modelKey);
              setModelKey(models[(i + 1) % models.length].key);
            }}
          >
            <Text style={styles.modelPick}>{models.find((m) => m.key === modelKey)?.label ?? modelKey} ▾</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView ref={scrollRef} style={styles.log} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {messages.length === 0 && <Text style={styles.empty}>Converse com a Órbita — no seu Qwen 2.5 local.</Text>}
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === "user" ? styles.user : styles.assistant]}>
            <Text style={m.role === "user" ? styles.userText : styles.assistantText}>
              {m.content || (mode !== "standby" && i === messages.length - 1 ? "…" : "")}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.composer}>
        <Pressable onPress={() => setVoiceOn((v) => !v)} style={styles.iconBtn}>
          <Text style={{ fontSize: 18 }}>{voiceOn ? "🔊" : "🔇"}</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="Fale ou escreva…"
          placeholderTextColor={theme.inkDim}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => send()}
          returnKeyType="send"
        />
        <Pressable onPress={toggleMic} disabled={mode !== "standby" && !recording} style={[styles.iconBtn, recording && { backgroundColor: theme.danger }]}>
          <Text style={{ fontSize: 18 }}>{recording ? "⏹" : "🎙️"}</Text>
        </Pressable>
        <Pressable style={styles.sendBtn} onPress={() => send()} disabled={mode !== "standby"}>
          {mode !== "standby" ? <ActivityIndicator color={theme.onGold} /> : <Text style={styles.sendText}>➤</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.ground },
  orbBar: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderBottomWidth: 1, borderBottomColor: theme.line },
  status: { color: theme.inkDim, fontSize: 13 },
  modelPick: { color: theme.gold, fontSize: 11, marginTop: 2 },
  log: { flex: 1 },
  empty: { color: theme.inkDim, textAlign: "center", marginTop: 40 },
  bubble: { padding: 12, borderRadius: 14, maxWidth: "85%" },
  user: { backgroundColor: theme.gold, alignSelf: "flex-end" },
  assistant: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, alignSelf: "flex-start" },
  userText: { color: theme.onGold },
  assistantText: { color: theme.ink },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.line },
  input: { flex: 1, borderWidth: 1, borderColor: theme.line, borderRadius: 12, padding: 12, color: theme.ink, backgroundColor: theme.surface },
  iconBtn: { borderWidth: 1, borderColor: theme.line, borderRadius: 12, width: 44, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface },
  sendBtn: { backgroundColor: theme.gold, borderRadius: 12, width: 48, alignItems: "center", justifyContent: "center" },
  sendText: { color: theme.onGold, fontSize: 18, fontWeight: "700" },
  logout: { color: theme.gold, marginRight: 8 },
  headerBtn: { color: theme.gold, fontSize: 20, marginLeft: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, borderTopWidth: 1, borderColor: theme.line },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { color: theme.ink, fontSize: 16, fontWeight: "700" },
  newChat: { color: theme.gold, fontSize: 14, fontWeight: "600" },
  convRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.line },
  convRowActive: { backgroundColor: theme.surface, borderRadius: 10, paddingHorizontal: 8 },
  convTitle: { color: theme.ink, fontSize: 14 },
  convMeta: { color: theme.inkDim, fontSize: 11, marginTop: 2 },
  convDelete: { fontSize: 16 },
});
