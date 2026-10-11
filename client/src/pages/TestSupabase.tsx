import { FormEvent, useCallback, useEffect, useState } from "react";

type HelloRow = { id: string; message: string; created_at: string };
const apiBase = import.meta.env.VITE_API_URL || "";

export default function TestSupabase() {
  const [rows, setRows] = useState<HelloRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/hello`);
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to read hello rows");
      setRows(payload.data || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to read hello rows"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/hello`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to write hello row");
      setMessage("");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to write hello row"
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "72px 24px",
        background: "linear-gradient(135deg,#faf9ff,#effcff)",
        color: "#292947",
        fontFamily: "var(--font-body, system-ui)",
      }}
    >
      <section
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: 28,
          border: "1px solid #ddd8ef",
          borderRadius: 16,
          background: "#ffffffcc",
          boxShadow: "0 20px 60px #54408a18",
        }}
      >
        <span
          style={{ color: "#7c3aed", fontSize: 11, letterSpacing: ".16em" }}
        >
          HOLO / SUPABASE TEST
        </span>
        <h1
          style={{
            margin: "12px 0 8px",
            fontSize: 40,
            letterSpacing: "-.06em",
          }}
        >
          Hello, <em>backend.</em>
        </h1>
        <p style={{ color: "#686b86", fontSize: 13 }}>
          A hidden connection check for the Phase 7 Section 1 integration.
        </p>
        <form
          onSubmit={submit}
          style={{ display: "flex", gap: 8, margin: "24px 0" }}
        >
          <input
            value={message}
            onChange={event => setMessage(event.target.value)}
            maxLength={200}
            placeholder="Type a message"
            aria-label="Hello message"
            style={{
              flex: 1,
              padding: "12px 14px",
              border: "1px solid #ddd8ef",
              borderRadius: 7,
              color: "#292947",
              background: "#fff",
            }}
          />
          <button
            type="submit"
            disabled={sending || !message.trim()}
            style={{
              padding: "12px 18px",
              border: 0,
              borderRadius: 7,
              color: "#fff",
              background: "linear-gradient(90deg,#7c3aed,#00c5df)",
              cursor: "pointer",
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
        {error && (
          <p
            role="alert"
            style={{
              padding: 12,
              borderRadius: 7,
              color: "#9a3b4b",
              background: "#fff0f2",
              fontSize: 12,
            }}
          >
            {error}
          </p>
        )}
        <h2
          style={{
            fontSize: 14,
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          Messages
        </h2>
        {loading ? (
          <p style={{ color: "#686b86" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "#686b86" }}>No rows yet.</p>
        ) : (
          <ul
            style={{ display: "grid", gap: 8, padding: 0, listStyle: "none" }}
          >
            {rows.map(row => (
              <li
                key={row.id}
                style={{
                  padding: 12,
                  border: "1px solid #eeeaf7",
                  borderRadius: 7,
                  background: "#fff",
                }}
              >
                <strong>{row.message}</strong>
                <small
                  style={{ display: "block", marginTop: 4, color: "#9291aa" }}
                >
                  {new Date(row.created_at).toLocaleString()}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
