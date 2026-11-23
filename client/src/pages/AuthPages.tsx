import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, loadSession, type SessionInfo } from "../lib/api";

function AuthShell({
  section,
  title,
  children,
}: {
  section: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="commerce-page">
      <header className="commerce-header">
        <a className="wordmark" href="/">
          HOLO
        </a>
      </header>
      <main className="checkout-main page-shell">
        <div className="checkout-heading">
          <span className="mono-label">HOLO / {section}</span>
          <h1>{title}</h1>
        </div>
        <div className="checkout-form auth-form">{children}</div>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  placeholder,
  required = true,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <p className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        className="auth-input"
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        onChange={event => onChange(event.target.value)}
      />
    </p>
  );
}

const Status = ({ tone, children }: { tone: "error" | "info"; children: ReactNode }) => (
  <p className={`auth-status auth-status--${tone}`} role={tone === "error" ? "alert" : "status"}>
    {children}
  </p>
);

const message = (error: string | undefined, fallback: string) => {
  switch (error) {
    case "invalid_credentials":
      return "That email and password combination was not accepted.";
    case "email_unavailable":
      return "An account already exists for that address.";
    case "rate_limited":
      return "Too many attempts. Wait a few minutes and try again.";
    case "password_too_short":
      return "Use at least 12 characters.";
    case "password_too_simple":
      return "Include at least one letter and one number.";
    case "token_invalid":
      return "That link is invalid, already used or expired.";
    case "invalid_request":
    case "invalid_email":
      return "Check the values you entered.";
    case "email_unverified":
      return "Confirm your email address first.";
    default:
      return fallback;
  }
};

export function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSession();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const result = await api("/auth/login", { method: "POST", body: { email, password } });
    setBusy(false);
    if (!result.ok) {
      setError(message(result.error, "Sign-in failed."));
      return;
    }
    window.location.assign("/workspace");
  };

  return (
    <AuthShell section="Account" title="Sign in">
      <form onSubmit={submit} noValidate>
        <Field id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error ? <Status tone="error">{error}</Status> : null}
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p>
        <a href="/register">Create an account</a> · <a href="/forgot-password">Forgot your password?</a>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSession();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const result = await api("/auth/register", {
      method: "POST",
      body: { email, password, displayName: displayName || undefined },
    });
    setBusy(false);
    if (!result.ok) {
      setError(message(result.error, "Registration failed."));
      return;
    }
    window.location.assign("/workspace");
  };

  return (
    <AuthShell section="Account" title="Create an account">
      <form onSubmit={submit} noValidate>
        <Field id="displayName" label="Your name" value={displayName} onChange={setDisplayName} autoComplete="name" required={false} />
        <Field id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          id="password"
          label="Password (12 characters or more)"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        {error ? <Status tone="error">{error}</Status> : null}
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p>
        Already registered? <a href="/sign-in">Sign in</a>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSession();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await api("/auth/password/forgot", { method: "POST", body: { email } });
    setBusy(false);
    setSent(true);
  };

  return (
    <AuthShell section="Account" title="Reset your password">
      {sent ? (
        <Status tone="info">
          If an account exists for that address, a single-use reset link is on its way.
        </Status>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p>
        <a href="/sign-in">Back to sign in</a>
      </p>
    </AuthShell>
  );
}

const queryToken = () => new URLSearchParams(window.location.search).get("token") ?? "";

export function ResetPasswordPage() {
  const token = useMemo(queryToken, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSession();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await api("/auth/password/reset", { method: "POST", body: { token, password } });
    setBusy(false);
    if (!result.ok) {
      setError(message(result.error, "The password could not be changed."));
      return;
    }
    setDone(true);
  };

  return (
    <AuthShell section="Account" title="Choose a new password">
      {done ? (
        <>
          <Status tone="info">Password updated. Every other session was signed out.</Status>
          <p>
            <a href="/sign-in">Sign in with the new password</a>
          </p>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field id="password" label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <Field id="confirm" label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {error ? <Status tone="error">{error}</Status> : null}
          <button className="button button--primary" type="submit" disabled={busy || !token}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const token = useMemo(queryToken, []);
  const [state, setState] = useState<"pending" | "verified" | "failed">("pending");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSession();
      if (!token) {
        if (!cancelled) setState("failed");
        return;
      }
      const result = await api("/auth/email/verify", { method: "POST", body: { token } });
      if (!cancelled) setState(result.ok ? "verified" : "failed");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthShell section="Account" title="Email verification">
      {state === "pending" ? <Status tone="info">Checking your link…</Status> : null}
      {state === "verified" ? (
        <>
          <Status tone="info">Your email address is verified.</Status>
          <p>
            <a href="/workspace">Go to your workspace</a>
          </p>
        </>
      ) : null}
      {state === "failed" ? (
        <>
          <Status tone="error">That verification link is invalid, already used or expired.</Status>
          <p>
            <a href="/workspace">Request a new link from your workspace</a>
          </p>
        </>
      ) : null}
    </AuthShell>
  );
}

export function AcceptInvitationPage() {
  const token = useMemo(queryToken, []);
  const [session, setSession] = useState<SessionInfo>();
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    (async () => {
      const current = await loadSession();
      setSession(current);
      if (!current.authenticated) return;
      const accepted = await api("/invitations/accept", { method: "POST", body: { token } });
      if (accepted.ok) setResult("Invitation accepted.");
      else setError(message(accepted.error, "The invitation could not be accepted."));
    })();
  }, [token]);

  return (
    <AuthShell section="Account" title="Join an organization">
      {session && !session.authenticated ? (
        <Status tone="info">
          Sign in with the invited address, then open this link again. <a href="/sign-in">Sign in</a>
        </Status>
      ) : null}
      {result ? <Status tone="info">{result}</Status> : null}
      {error ? <Status tone="error">{error}</Status> : null}
      <p>
        <a href="/workspace">Open your workspace</a>
      </p>
    </AuthShell>
  );
}
