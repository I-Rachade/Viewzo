/// Connecting accounts by logging in on the platform is hidden for now:
/// creators add them by hand in "Mes comptes" and the team checks them.
/// Build with --dart-define=OAUTH_CONNECTIONS=true to show it again.
const oauthConnections = bool.fromEnvironment('OAUTH_CONNECTIONS');
