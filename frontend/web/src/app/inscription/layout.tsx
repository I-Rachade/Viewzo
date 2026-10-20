import type { Viewport } from "next";

// The browser bar matches the dark header of the sign-in screens.
export const viewport: Viewport = { themeColor: "#16151d" };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
