"use client";

import { useCallback, useEffect, useState } from "react";

export const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

// Loads a back-office list and runs actions on it, reloading afterwards.
export function useQueue<T>(load: () => Promise<T[]>, onChange: () => void) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      load()
        .then(setItems)
        .catch((e) => setError((e as Error).message)),
    [load],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return { items, error, busy, act };
}
