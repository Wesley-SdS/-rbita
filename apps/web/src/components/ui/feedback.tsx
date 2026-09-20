/**
 * Falha com caminho de volta. Existe para que o painel não engula o erro num
 * `.catch(() => {})`: quem está olhando precisa saber que não carregou e poder
 * tentar de novo sem recarregar a página.
 */
export function ErrorRetry({ message, onRetry, className = "" }: {
  message: string; onRetry?: () => void; className?: string;
}) {
  return (
    <div role="alert" className={`aviso-erro ${className}`.trim()}>
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="button danger mini">
          Tentar de novo
        </button>
      )}
    </div>
  );
}
