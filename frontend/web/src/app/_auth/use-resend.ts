"use client";

import { useEffect, useState } from "react";

// SMS can take a few minutes to arrive, and every new code cancels the
// previous one, so asking again too early locks people out.
const RESEND_DELAY_MS = 2 * 60 * 1000;

export function formatWait(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Tracks when the last code went out and how long until the next one.
export function useResend() {
  const [sentAt, setSentAt] = useState<number | null>(null);
  // Set when a code is sent, then ticked while the wait runs.
  const [now, setNow] = useState(0);
  const waitMs = sentAt ? Math.max(0, sentAt + RESEND_DELAY_MS - now) : 0;
  const waiting = waitMs > 0;

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  function markSent() {
    const at = Date.now();
    setSentAt(at);
    setNow(at);
  }

  return { waitMs, waiting, markSent };
}
