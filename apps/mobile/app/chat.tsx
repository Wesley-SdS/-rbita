import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { router, Stack } from "expo-router";
import { Orb, type OrbMode } from "@/components/Orb";
import { streamChat, fetchModels } from "@/lib/chat";
import { getSession, signOut } from "@/lib/auth";
import { startRecording, stopRecordingAndTranscribe, speak } from "@/lib/voice";

interface Msg { role: "user" | "assistant"; content: string }

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<OrbMode>("standby");
  const [modelKey, setModelKey] = useState("local/qwen2.5:7b");
  const [recording, setRecording] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const convId = useRef<string | undefined>(undefined);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    getSession().then((u) => { if (!u) router.replace("/"); });
    fetchModels().then(({ defaultModel }) => setModelKey(defaultModel)).catch(() => {});
  }, []);

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
      <Stack.Screen options={{ headerRight: () => (
        <Pressable onPress={async () => { await signOut(); router.replace("/"); }}>
          <Text style={styles.logout}>Sair</Text>
        </Pressable>
      ) }} />

      <View style={styles.orbBar}>
        <Orb mode={mode} size={72} />
        <Text style={styles.status}>
          {mode === "standby" ? "em espera" : mode === "thinking" ? "pensando…" : mode === "speaking" ? "respondendo…" : "ouvindo…"}
        </Text>
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
          placeholderTextColor="#8a7a63"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => send()}
          returnKeyType="send"
        />
        <Pressable onPress={toggleMic} disabled={mode !== "standby" && !recording} style={[styles.iconBtn, recording && { backgroundColor: "#e0705a" }]}>
          <Text style={{ fontSize: 18 }}>{recording ? "⏹" : "🎙️"}</Text>
        </Pressable>
        <Pressable style={styles.sendBtn} onPress={() => send()} disabled={mode !== "standby"}>
          {mode !== "standby" ? <ActivityIndicator color="#241403" /> : <Text style={styles.sendText}>➤</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#120d08" },
  orbBar: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderBottomWidth: 1, borderBottomColor: "#2a2016" },
  status: { color: "#8a7a63", fontSize: 13 },
  log: { flex: 1 },
  empty: { color: "#8a7a63", textAlign: "center", marginTop: 40 },
  bubble: { padding: 12, borderRadius: 14, maxWidth: "85%" },
  user: { backgroundColor: "#e0a83a", alignSelf: "flex-end" },
  assistant: { backgroundColor: "#1a130c", borderWidth: 1, borderColor: "#2a2016", alignSelf: "flex-start" },
  userText: { color: "#241403" },
  assistantText: { color: "#f0e6d8" },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#2a2016" },
  input: { flex: 1, borderWidth: 1, borderColor: "#3a2f22", borderRadius: 12, padding: 12, color: "#f0e6d8", backgroundColor: "#1a130c" },
  iconBtn: { borderWidth: 1, borderColor: "#3a2f22", borderRadius: 12, width: 44, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: "#1a130c" },
  sendBtn: { backgroundColor: "#e0a83a", borderRadius: 12, width: 48, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#241403", fontSize: 18, fontWeight: "700" },
  logout: { color: "#e0a83a", marginRight: 8 },
});
