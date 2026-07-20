import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert, ScrollView } from "react-native";
import { router, Link } from "expo-router";
import { Orb } from "@/components/Orb";
import { GoogleLogo, GitHubLogo } from "@/components/ProviderLogos";
import { signIn, signUp, getSession, sendMagicLink, socialSignIn } from "@/lib/auth";
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

  async function magic() {
    if (!email.trim()) { Alert.alert("Link mágico", "Digite seu email primeiro."); return; }
    setBusy(true);
    try {
      await sendMagicLink(email.trim());
      Alert.alert("Link enviado", `Enviamos um link de acesso para ${email.trim()}.`);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Núcleo neural GRANDE e sem caixa — fundo #0a0703 (= fundo do canvas do Orb),
          então não há retângulo destacado. Idêntico ao web. */}
      <Orb mode="standby" size={300} />
      <Text style={styles.title}>ÓRBITA</Text>
      <Text style={styles.sub}>Seu assistente pessoal de IA</Text>

      <View style={styles.form}>
        {mode === "up" && (
          <TextInput style={styles.input} placeholder="Nome" placeholderTextColor={theme.inkDim} value={name} onChangeText={setName} />
        )}
        <TextInput style={styles.input} placeholder="Email" placeholderTextColor={theme.inkDim}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress"
          value={email} onChangeText={setEmail} />
        <TextInput style={styles.input} placeholder="Senha (mín. 8)" placeholderTextColor={theme.inkDim}
          secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password"
          value={password} onChangeText={setPassword} />
        <Pressable style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={theme.onGold} /> : <Text style={styles.buttonText}>{mode === "up" ? "Criar conta" : "Entrar"}</Text>}
        </Pressable>
      </View>

      {/* divisor */}
      <View style={styles.divider}>
        <View style={styles.line} /><Text style={styles.dividerText}>ou</Text><View style={styles.line} />
      </View>

      {/* social lado a lado (com logo) + link mágico */}
      <View style={styles.form}>
        <View style={styles.socialRow}>
          <Pressable style={[styles.social, styles.socialHalf]} onPress={() => socialSignIn("google")} disabled={busy}>
            <GoogleLogo size={18} /><Text style={styles.socialText}>Google</Text>
          </Pressable>
          <Pressable style={[styles.social, styles.socialHalf]} onPress={() => socialSignIn("github")} disabled={busy}>
            <GitHubLogo size={18} color={theme.ink} /><Text style={styles.socialText}>GitHub</Text>
          </Pressable>
        </View>
        <Pressable style={styles.social} onPress={magic} disabled={busy}>
          <Text style={styles.socialText}>✉️  Enviar link mágico por email</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => setMode(mode === "in" ? "up" : "in")}>
        <Text style={styles.link}>{mode === "in" ? "Não tem conta? Criar" : "Já tem conta? Entrar"}</Text>
      </Pressable>
      <Link href="/settings" style={styles.serverLink}>
        <Text style={styles.serverLinkText}>⚙ configurar servidor</Text>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // fundo IGUAL à cor real que o canvas do Orb satura (#080502) → sem retângulo
  container: { flex: 1, backgroundColor: "#080502" },
  content: { alignItems: "center", justifyContent: "center", padding: 24, paddingTop: 40, paddingBottom: 40 },
  center: { alignItems: "center", justifyContent: "center", flex: 1 },
  // cor + glow IDÊNTICOS ao web (#ffd79a com brilho) — antes ficava "pastel" sem o glow.
  title: { color: "#ffd79a", fontSize: 34, fontWeight: "900", letterSpacing: 6, marginTop: 4, textShadowColor: "rgba(255,170,60,0.55)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 24 },
  sub: { color: theme.inkDim, marginTop: 6 },
  form: { gap: 12, width: "100%", maxWidth: 380, marginTop: 20 },
  input: { borderWidth: 1, borderColor: theme.line, borderRadius: 12, padding: 14, color: theme.ink, backgroundColor: theme.surface },
  button: { backgroundColor: theme.gold, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 4 },
  buttonText: { color: theme.onGold, fontWeight: "700", fontSize: 16 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, width: "100%", maxWidth: 380, marginTop: 16 },
  line: { flex: 1, height: 1, backgroundColor: theme.line },
  dividerText: { color: theme.inkDim, fontSize: 12 },
  social: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, borderRadius: 12, padding: 13 },
  socialRow: { flexDirection: "row", gap: 10 },
  socialHalf: { flex: 1 },
  socialText: { color: theme.ink, fontWeight: "600", fontSize: 14 },
  link: { color: theme.gold, textAlign: "center", marginTop: 18 },
  serverLink: { alignSelf: "center", marginTop: 16 },
  serverLinkText: { color: theme.inkDim, fontSize: 12 },
});
