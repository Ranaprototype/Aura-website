import { useEffect, useState } from "react";
import { CommerceStatus } from "../components/CommerceStatus";

export default function TestSupabase() {
  const [status, setStatus] = useState("Checking database readiness…");
  useEffect(() => {
    const abort = new AbortController();
    async function check() {
      try {
        const response = await fetch("/api/health/ready", {
          signal: abort.signal,
        });
        const ready = response.ok && (await response.json()).status === "ready";
        if (!abort.signal.aborted)
          setStatus(ready ? "Database ready." : "Database unavailable.");
      } catch {
        if (!abort.signal.aborted) setStatus("Database unavailable.");
      }
    }
    void check();
    return () => abort.abort();
  }, []);
  return (
    <CommerceStatus section="Diagnostics" title="Connection status">
      <p role="status">{status}</p>
    </CommerceStatus>
  );
}
