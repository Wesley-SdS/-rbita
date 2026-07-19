import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { router, Link } from "expo-router";
import { Orb } from "@/components/Orb";
import { signIn, signUp, getSession } from "@/lib/auth";
import { theme } from "@/lib/theme";

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getSession()
      .then((u) => { if (u) router.replace("/chat"); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "up") await signUp(name.trim(), email.trim(), password);
      else await signIn(email.trim(), password);
      router.replace("/chat");
    } catch (e) {
      Alert.alert("Ops", e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={theme.gold} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Orb mode="standby" size={160} />
        <Text style={styles.title}>ÓRBITA</Text>
        <Text style={styles.sub}>Seu assistente pessoal de IA</Text>
      </View>

      <View style={styles.form}>
        {mode === "up" && (
          <TextInput style={styles.input} placeholder="Nome" placeholderTextColor={theme.inkDim} value={name} onChangeText={setName} />
        )}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={theme.inkDim}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Senha (mín. 8)"
          placeholderTextColor={theme.inkDim}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Pressable style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={theme.onGold} /> : <Text style={styles.buttonText}>{mode === "up" ? "Criar conta" : "Entrar"}</Text>}
        </Pressable>
        <Pressable onPress={() => setMode(mode === "in" ? "up" : "in")}>
          <Text style={styles.link}>{mode === "in" ? "Não tem conta? Criar" : "Já tem conta? Entrar"}</Text>
        </Pressable>
        <Link href="/settings" style={styles.serverLink}>
          <Text style={styles.serverLinkText}>⚙ configurar servidor</Text>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.ground, padding: 24, justifyContent: "center" },
  center: { alignItems: "center", marginBottom: 32 },
  title: { color: theme.gold, fontSize: 34, fontWeight: "900", letterSpacing: 4, marginTop: 16 },
  sub: { color: theme.inkDim, marginTop: 4 },
  form: { gap: 12 },
  input: { borderWidth: 1, borderColor: theme.line, borderRadius: 12, padding: 14, color: theme.ink, backgroundColor: theme.surface },
  button: { backgroundColor: theme.gold, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 4 },
  buttonText: { color: theme.onGold, fontWeight: "700", fontSize: 16 },
  link: { color: theme.gold, textAlign: "center", marginTop: 8 },
  serverLink: { alignSelf: "center", marginTop: 16 },
  serverLinkText: { color: theme.inkDim, fontSize: 12 },
});
