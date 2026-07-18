import { useEffect, useRef } from "react";
import { Animated, View, Easing, StyleSheet } from "react-native";

export type OrbMode = "standby" | "listening" | "speaking" | "thinking";

/**
 * Orb do celular — núcleo neural pulsante (versão leve do Orb web, sem WebGL).
 * Reage ao estado: respira em standby, pulsa mais rápido ao falar/pensar.
 */
export function Orb({ mode = "standby", size = 200 }: { mode?: OrbMode; size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const dur = mode === "speaking" ? 420 : mode === "thinking" ? 700 : mode === "listening" ? 900 : 2200;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mode, pulse]);

  const color =
    mode === "listening" ? "#5aa8e0" : mode === "thinking" ? "#7ad08a" : "#e0a83a";
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.halo,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: haloOpacity, transform: [{ scale }] },
        ]}
      />
      <Animated.View
        style={[
          styles.core,
          {
            width: size * 0.62,
            height: size * 0.62,
            borderRadius: (size * 0.62) / 2,
            backgroundColor: color,
            transform: [{ scale }],
          },
        ]}
      />
      <View style={[styles.ring, { width: size * 0.9, height: size * 0.4, borderRadius: size * 0.2, borderColor: color }]} />
      <View style={[styles.ring, { width: size * 0.4, height: size * 0.9, borderRadius: size * 0.2, borderColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute" },
  core: { position: "absolute", shadowColor: "#e0a83a", shadowOpacity: 0.8, shadowRadius: 30 },
  ring: { position: "absolute", borderWidth: 1.5, opacity: 0.5 },
});
