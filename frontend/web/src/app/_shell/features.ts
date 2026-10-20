// Connecting accounts by logging in on the platform is hidden for now:
// creators add them by hand in "Mes comptes" and the team checks them.
// NEXT_PUBLIC_OAUTH_CONNECTIONS=1 shows "Comptes connectés" again.
export const OAUTH_CONNECTIONS =
  process.env.NEXT_PUBLIC_OAUTH_CONNECTIONS === "1";
