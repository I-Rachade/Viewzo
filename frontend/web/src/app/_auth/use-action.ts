"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";

// Runs one API call at a time and keeps its error message.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(
    action: () => Promise<void>,
    onError?: (e: ApiError) => boolean,
  ) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (!(e instanceof ApiError && onError?.(e))) {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run };
}
