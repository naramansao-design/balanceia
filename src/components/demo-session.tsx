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
function useDemoState() {
  const [session, setSession] = useState(false),
    [terms, setTerms] = useState(false),
    [cast, setCast] = useState<Character[]>([]),
    [generations, setGenerations] = useState<Generation[]>([]);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    if (
      !generations.some(
        (g) => g.status === "waiting" || g.status === "processing",
      )
    )
      return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const updates = await Promise.all(
          generations
            .filter((g) => g.status === "waiting" || g.status === "processing")
            .map(async (g) => {
              const response = await fetch(
                "/api/demo/generations?id=" + encodeURIComponent(g.id),
              );
              if (!response.ok) throw Error();
              return {
                id: g.id,
                status: (await response.json()).status as string,
              };
            }),
        );
        if (!cancelled)
          setGenerations((prev) =>
            prev.map((g) => {
              const update = updates.find((u) => u.id === g.id);
              return update
                ? {
                    ...g,
                    status:
                      update.status === "completed" && g.failed
                        ? "failed"
                        : update.status,
                  }
                : g;
            }),
          );
      } catch {
        if (!cancelled)
          setGenerations((prev) =>
            prev.map((g) =>
              g.status === "waiting" || g.status === "processing"
                ? { ...g, status: "failed" }
                : g,
            ),
          );
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [generations]);
  useEffect(() => {
    const current = urls.current;
    return () => current.forEach(URL.revokeObjectURL);
  }, []);
  return {
    session,
    setSession,
    terms,
    setTerms,
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
