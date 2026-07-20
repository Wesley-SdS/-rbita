import { useEffect, useRef, useState } from "react";
import type { OrbMode } from "@/components/orb";

/**
 * Estado do Orb compartilhado entre chat e voz. Mantém um `modeRef` espelhado
 * para uso em callbacks assíncronos (wake word/TTS) sem stale closure.
 */
export function useOrbMode() {
  const [mode, setMode] = useState<OrbMode>("standby");
  const modeRef = useRef<OrbMode>("standby");
  useEffect(() => { modeRef.current = mode; }, [mode]);
  return { mode, setMode, modeRef };
}
