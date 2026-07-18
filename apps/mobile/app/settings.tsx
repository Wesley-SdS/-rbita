import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { router } from "expo-router";
import { getBaseUrl, setBaseUrl } from "@/lib/api";

export default function Settings() {
  const [url, setUrl] = useState("");

  useEffect(() => {
    getBaseUrl().then(setUrl);
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

  return (
    <View style={styles.container}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#120d08", padding: 24, gap: 12 },
  label: { color: "#f0e6d8", fontSize: 16, fontWeight: "600" },
  hint: { color: "#8a7a63", fontSize: 13 },
  input: { borderWidth: 1, borderColor: "#3a2f22", borderRadius: 12, padding: 14, color: "#f0e6d8", backgroundColor: "#1a130c" },
  button: { backgroundColor: "#e0a83a", borderRadius: 12, padding: 15, alignItems: "center" },
  buttonText: { color: "#241403", fontWeight: "700", fontSize: 16 },
});
