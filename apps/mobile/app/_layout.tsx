import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { theme } from "@/lib/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.ground },
          headerTintColor: theme.gold,
          contentStyle: { backgroundColor: theme.ground },
        }}
      >
        <Stack.Screen name="index" options={{ title: "ÓRBITA", headerShown: false }} />
        <Stack.Screen name="chat" options={{ title: "ÓRBITA" }} />
        <Stack.Screen name="settings" options={{ title: "Servidor" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
