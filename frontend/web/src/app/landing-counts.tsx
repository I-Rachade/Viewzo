"use client";

import { CountUp } from "./count-up";

// The phone's two counters on the landing page (formatters stay client-side).
export function LandingCount({ value, money }: { value: number; money?: boolean }) {
  return (
    <CountUp
      value={value}
      format={(n) => `${n.toLocaleString("fr-FR")}${money ? " F" : ""}`}
    />
  );
}
