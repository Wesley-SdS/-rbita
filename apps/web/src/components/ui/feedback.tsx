/**
 * Estado de erro com ação de repetir. Padroniza o tratamento de falha nos
 * painéis (hoje muitos engolem o erro com `.catch(()=>{})`). Acessível
 * (`role="alert"`), tom de perigo, botão opcional "tentar de novo".
 */
export function ErrorRetry({ message, onRetry, className = "" }: {
  message: string; onRetry?: () => void; className?: string;
}) {
  return (
    <div role="alert" className={`flex items-center gap-2 text-[11px] ${className}`} style={{ color: "var(--color-danger)" }}>
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          tentar de novo
        </button>
      )}
    </div>
  );
}
