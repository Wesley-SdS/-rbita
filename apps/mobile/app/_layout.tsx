import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#120d08" },
          headerTintColor: "#e0a83a",
          contentStyle: { backgroundColor: "#120d08" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "ÓRBITA", headerShown: false }} />
        <Stack.Screen name="chat" options={{ title: "ÓRBITA" }} />
        <Stack.Screen name="settings" options={{ title: "Servidor" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
