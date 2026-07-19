import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView } from "react-native";
import { router } from "expo-router";
import { getBaseUrl, setBaseUrl } from "@/lib/api";
import { getProfile, putProfile, type ProfileData } from "@/lib/chat";

export default function Settings() {
  const [url, setUrl] = useState("");
  const [profile, setProfile] = useState<ProfileData>({ assistantName: "Órbita", userName: "", persona: "" });
  const [savingPersona, setSavingPersona] = useState(false);

  useEffect(() => {
    getBaseUrl().then(setUrl);
    getProfile().then((p) => setProfile({ assistantName: p.assistantName, userName: p.userName ?? "", persona: p.persona ?? "" })).catch(() => {});
  }, []);

  async function save() {
    if (!/^https?:\/\//.test(url)) {
      Alert.alert("URL inválida", "Use http://IP:3000 do seu PC.");
      return;
    }
    await setBaseUrl(url);
    Alert.alert("Salvo", "Servidor configurado.");
    router.back();
  }

  async function savePersona() {
    setSavingPersona(true);
    try {
      const ok = await putProfile(profile);
      Alert.alert(ok ? "Salvo" : "Erro", ok ? "Persona atualizada." : "Não foi possível salvar.");
    } finally {
      setSavingPersona(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
      <Text style={styles.label}>Endereço do backend ÓRBITA</Text>
      <Text style={styles.hint}>No celular, use o IP do seu PC na rede (ex: http://192.168.0.10:3000).</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        keyboardType="url"
        placeholder="http://192.168.0.10:3000"
        placeholderTextColor="#8a7a63"
      />
      <Pressable style={styles.button} onPress={save}>
        <Text style={styles.buttonText}>Salvar</Text>
      </Pressable>

      <View style={styles.divider} />
      <Text style={styles.label}>Persona</Text>
      <Text style={styles.hint}>Personalize a assistente — vale no celular e no PC.</Text>
      <Text style={styles.fieldLabel}>Nome da assistente</Text>
      <TextInput style={styles.input} value={profile.assistantName} maxLength={40}
        onChangeText={(t) => setProfile((p) => ({ ...p, assistantName: t }))} placeholder="Órbita" placeholderTextColor="#8a7a63" />
      <Text style={styles.fieldLabel}>Como te chamar</Text>
      <TextInput style={styles.input} value={profile.userName ?? ""} maxLength={40}
        onChangeText={(t) => setProfile((p) => ({ ...p, userName: t }))} placeholder="opcional" placeholderTextColor="#8a7a63" />
      <Text style={styles.fieldLabel}>Tom & preferências</Text>
      <TextInput style={[styles.input, { height: 90, textAlignVertical: "top" }]} value={profile.persona ?? ""} maxLength={2000} multiline
        onChangeText={(t) => setProfile((p) => ({ ...p, persona: t }))} placeholder="Ex.: seja direto; me trate por você." placeholderTextColor="#8a7a63" />
      <Pressable style={styles.button} onPress={savePersona} disabled={savingPersona}>
        <Text style={styles.buttonText}>{savingPersona ? "Salvando…" : "Salvar persona"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#120d08", padding: 24 },
  label: { color: "#f0e6d8", fontSize: 16, fontWeight: "600" },
  fieldLabel: { color: "#8a7a63", fontSize: 12 },
  hint: { color: "#8a7a63", fontSize: 13 },
  divider: { height: 1, backgroundColor: "#2a2016", marginVertical: 8 },
  input: { borderWidth: 1, borderColor: "#3a2f22", borderRadius: 12, padding: 14, color: "#f0e6d8", backgroundColor: "#1a130c" },
  button: { backgroundColor: "#e0a83a", borderRadius: 12, padding: 15, alignItems: "center" },
  buttonText: { color: "#241403", fontWeight: "700", fontSize: 16 },
});
