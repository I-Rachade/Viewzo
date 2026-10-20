import { ApiError } from "@/lib/api";

// The API answers 404 MODULE_OFF on every live route while the module is off.
export function isUnavailable(e: unknown) {
  return e instanceof ApiError && e.code === "MODULE_OFF";
}

export const UNAVAILABLE = "La vente en live n’est pas disponible pour le moment.";
