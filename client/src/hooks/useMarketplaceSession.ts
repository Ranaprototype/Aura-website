import { useEffect, useState } from "react";
import { loadSession, type SessionInfo } from "../lib/api";

/**
 * Loads the verified session and the organization the seller is acting in.
 * The organization id is only a selector: the server decides membership and
 * refuses any organization the account does not belong to.
 */
export function useMarketplaceSession() {
  const [session, setSession] = useState<SessionInfo>();
  const [orgId, setOrgId] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void loadSession().then(current => {
      if (!active) return;
      setSession(current);
      setOrgId(current.organizations?.[0]?.id);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (session && !session.authenticated) window.location.replace("/sign-in");
  }, [session]);

  return { session, orgId, setOrgId };
}
