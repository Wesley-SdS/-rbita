import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type Size = "sm" | "md";
const BASE = "rounded-lg border outline-none";
const PAD: Record<Size, string> = { sm: "px-2 py-1.5 text-xs", md: "px-3 py-2 text-sm" };
const FIELD_STYLE = { borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" } as const;

// `size` é omitido dos atributos nativos (no <input> ele é `number`) p/ usarmos
// nosso union sm/md sem colisão de tipos.
/** Campo de texto de uma linha, no tom "ground" com borda discreta. */
export function Input({ size = "sm", className = "", style, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: Size }) {
  return <input {...rest} className={`${BASE} ${PAD[size]} ${className}`} style={{ ...FIELD_STYLE, ...style }} />;
}

/** Área de texto multi-linha (mesmo tom do Input). */
export function Textarea({ size = "md", className = "", style, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & { size?: Size }) {
  return <textarea {...rest} className={`${BASE} ${PAD[size]} ${className}`} style={{ ...FIELD_STYLE, ...style }} />;
}
