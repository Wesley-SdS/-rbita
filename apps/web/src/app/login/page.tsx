"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth-client";
import { Nucleo } from "@/components/presenca/nucleo";

type Social = "google" | "github";

/** Logo oficial do Google (4 cores). */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Logo do GitHub (mono, herda a cor do texto). */
function GitHubLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.8 5.65-5.48 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58C20.56 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await signUp.email({ name, email, password })
          : await signIn.email({ email, password });
      if (res.error) setError(res.error.message ?? "Falha na autenticação");
      else router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: Social) {
    setError(null); setInfo(null); setBusy(true);
    try {
      await signIn.social({ provider, callbackURL: "/app" }); // redireciona o navegador
    } catch {
      setError(`Não foi possível entrar com ${provider}. Verifique se está configurado no servidor.`);
      setBusy(false);
    }
  }

  async function magicLink() {
    if (!email.trim()) { setError("Digite seu email para receber o link mágico."); return; }
    setError(null); setInfo(null); setBusy(true);
    try {
      const r = await signIn.magicLink({ email: email.trim(), callbackURL: "/app" });
      if (r.error) setError(r.error.message ?? "Falha ao enviar o link mágico.");
      else setInfo(`Enviamos um link de acesso para ${email.trim()}. Confira seu email.`);
    } catch {
      setError("Falha ao enviar o link mágico.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="entrada">
      {/* O núcleo abre a porta: é a primeira coisa que a pessoa vê da Órbita, e
          é o mesmo do resto do app, não uma ilustração à parte. */}
      <div className="entrada-nucleo">
        <Nucleo estado="idle" />
      </div>

      <span className="brand entrada-marca">
        <span className="brand-symbol" aria-hidden="true" />
        <span>
          órbita<span className="brand-period">.</span>
        </span>
      </span>
      <p className="entrada-linha">Seu assistente pessoal de IA, na sua máquina.</p>

      <form onSubmit={submit} className="panel entrada-forma">
        {mode === "signup" && (
          <label className="field">
            Como quer ser chamado
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Seu nome" />
          </label>
        )}
        <label className="field">
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="voce@exemplo.com" />
        </label>
        <label className="field">
          Senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder="Ao menos 8 caracteres"
          />
        </label>

        {error && (
          <p role="alert" className="aviso-erro">
            <span>{error}</span>
          </p>
        )}
        {info && <p className="notice">{info}</p>}

        <button type="submit" disabled={busy} className="button primary full-width">
          {busy ? "Um instante…" : mode === "login" ? "Entrar" : "Criar minha conta"}
        </button>

        <div className="entrada-ou">
          <span />
          ou
          <span />
        </div>

        <div className="entrada-sociais">
          <button type="button" onClick={() => social("google")} disabled={busy} className="button secondary">
            <GoogleLogo />
            Google
          </button>
          <button type="button" onClick={() => social("github")} disabled={busy} className="button secondary">
            <GitHubLogo />
            GitHub
          </button>
        </div>
        <button type="button" onClick={magicLink} disabled={busy} className="button subtle full-width">
          Receber um link por e-mail
        </button>

        <button
          type="button"
          className="text-button entrada-troca"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "login" ? "Não tem conta? Criar uma" : "Já tenho conta. Entrar"}
        </button>
      </form>

      <footer className="entrada-rodape">Local-first. Seus dados ficam com você.</footer>
    </main>
  );
}
