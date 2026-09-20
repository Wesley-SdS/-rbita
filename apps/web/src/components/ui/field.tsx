import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type Size = "sm" | "md";

/**
 * Campos do Presença. `.inline-input` é a versão sem rótulo acoplado (a com
 * rótulo é `.field`, usada diretamente nas telas novas).
 *
 * `size` é omitido dos atributos nativos porque no `<input>` ele é numérico e
 * colidiria com o nosso par sm/md.
 */
export function Input({ size = "sm", className = "", ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: Size }) {
  return <input {...rest} className={`inline-input ${size === "sm" ? "compacto" : ""} ${className}`.trim()} />;
}

export function Textarea({ size = "md", className = "", ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & { size?: Size }) {
  return <textarea {...rest} className={`inline-input ${size === "sm" ? "compacto" : ""} ${className}`.trim()} />;
}

export function Select({ size = "sm", className = "", ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: Size }) {
  return <select {...rest} className={`inline-input ${size === "sm" ? "compacto" : ""} ${className}`.trim()} />;
}
