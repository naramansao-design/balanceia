"use client";
import { createContext, useContext, useState, useRef, useEffect } from "react";
export type Character = {
  id: string;
  name: string;
  url: string;
  consentAt: string;
};
export type Generation = {
  id: string;
  title: string;
  status: string;
  failed: boolean;
};
/** Mirrors the two separate columns the database requires before a reservation:
 * aceitou_termos_em and maior_de_idade_confirmado_em. Timestamps are taken in the
 * browser only because this demo has no server session; the real adapter must
 * record them server-side. */
export type Consents = { termsAt: string | null; ageAt: string | null };
const pendingStatus = (status: string) =>
  status === "waiting" || status === "processing";
function useDemoState() {
  const [session, setSession] = useState(false),
    [consents, setConsents] = useState<Consents>({
      termsAt: null,
      ageAt: null,
    }),
    [cast, setCast] = useState<Character[]>([]),
    [generations, setGenerations] = useState<Generation[]>([]);
  const urls = useRef<string[]>([]);
  const latest = useRef<Generation[]>([]);
  useEffect(() => {
    latest.current = generations;
  }, [generations]);
  // Keyed on whether anything is pending, so the interval is not torn down and
  // recreated on every status update.
  const polling = generations.some((g) => pendingStatus(g.status));
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const updates = await Promise.all(
        latest.current
          .filter((g) => pendingStatus(g.status))
          .map(async (g) => {
            // A failed poll fails only its own generation, never the whole list.
            try {
              const response = await fetch(
                "/api/demo/generations?id=" + encodeURIComponent(g.id),
              );
              if (!response.ok) throw Error();
              return {
                id: g.id,
                status: (await response.json()).status as string,
              };
            } catch {
              return { id: g.id, status: "failed" };
            }
          }),
      );
      if (cancelled) return;
      setGenerations((prev) =>
        prev.map((g) => {
          const update = updates.find((u) => u.id === g.id);
          if (!update) return g;
          return {
            ...g,
            status:
              update.status === "completed" && g.failed
                ? "failed"
                : update.status,
          };
        }),
      );
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling]);
  useEffect(() => {
    const current = urls.current;
    return () => current.forEach(URL.revokeObjectURL);
  }, []);
  function recordConsent(key: keyof Consents, checked: boolean) {
    setConsents((prev) => ({
      ...prev,
      [key]: checked ? new Date().toISOString() : null,
    }));
  }
  return {
    session,
    setSession,
    consents,
    recordConsent,
    cast,
    setCast,
    generations,
    setGenerations,
    urls,
  };
}
const Context = createContext<ReturnType<typeof useDemoState> | null>(null);
export function DemoSession({ children }: { children: React.ReactNode }) {
  const value = useDemoState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDemo() {
  const value = useContext(Context);
  if (!value) throw Error("Missing demo context");
  return value;
}
