import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../creator_models.dart';
import '../task_models.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Platform accounts the creator connects so Viewzo reads the views itself.
class ConnectionsScreen extends StatefulWidget {
  const ConnectionsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<ConnectionsScreen> createState() => _ConnectionsScreenState();
}

class _ConnectionsScreenState extends State<ConnectionsScreen>
    with WidgetsBindingObserver {
  List<Connection>? _items;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Back from the platform's login page in the browser: show the new state.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Serveur injoignable');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _load() => _run(() async {
    final items = await widget.api.connections();
    if (mounted) setState(() => _items = items);
  });

  Future<void> _connect(SocialNetwork network) => _run(() async {
    final url = await widget.api.connectionStartUrl(network);
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  });

  Future<void> _disconnect(SocialNetwork network) => _run(() async {
    await widget.api.disconnect(network);
    await _load();
    if (mounted) showVzToast(context, '${network.label} déconnecté');
  });

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final theme = ShadTheme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Comptes connectés')),
      body: items == null && _error == null
          ? const SkeletonList()
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                Text(
                  'Connecte tes comptes : Viewzo relève lui-même les vues de '
                  'tes publications, sans capture d’écran, et ta validation '
                  'va plus vite.',
                  style: theme.textTheme.p.copyWith(height: 1.45),
                ),
                const SizedBox(height: 16),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: ShadAlert.destructive(
                      icon: const Icon(LucideIcons.circleAlert),
                      title: Text(_error!),
                    ),
                  ),
                if (items != null && items.isNotEmpty)
                  FadeSlideIn(
                    child: ShadCard(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Column(
                        children: [
                          for (final (i, c) in items.indexed) ...[
                            if (i > 0)
                              const ShadSeparator.horizontal(
                                margin: EdgeInsets.only(left: 56),
                              ),
                            _ConnectionTile(
                              connection: c,
                              busy: _busy,
                              onConnect: () => _connect(c.network),
                              onDisconnect: () => _disconnect(c.network),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                ShadAlert(
                  icon: const Icon(LucideIcons.info),
                  description: Text(
                    'YouTube, X et Telegram n’ont pas besoin de connexion : '
                    'leurs vues sont publiques. Pour un statut WhatsApp, envoie '
                    'tes captures dans Mes tâches.',
                    style: theme.textTheme.muted,
                  ),
                ),
              ],
            ),
    );
  }
}

class _ConnectionTile extends StatelessWidget {
  const _ConnectionTile({
    required this.connection,
    required this.busy,
    required this.onConnect,
    required this.onDisconnect,
  });
  final Connection connection;
  final bool busy;
  final VoidCallback onConnect;
  final VoidCallback onDisconnect;

  @override
  Widget build(BuildContext context) {
    final c = connection;
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    final dark = theme.brightness == Brightness.dark;
    final green = dark ? const Color(0xFF7BE0B0) : VzColors.paidText;
    // A failing connection is flagged in amber, not shown as healthy.
    final failing = c.lastError != null;
    final warning = dark ? const Color(0xFFFFD27A) : const Color(0xFF8A5600);
    final status = c.connected
        ? 'Connecté${c.handle != null ? ' : ${c.handle}' : ''}'
        : c.available
        ? 'Non connecté'
        : 'Bientôt disponible';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        spacing: 14,
        children: [
          Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: failing
                  ? const Color(0x33F5A524)
                  : c.connected
                  ? const Color(0x221FA971)
                  : colors.secondary,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              failing
                  ? LucideIcons.triangleAlert
                  : c.connected
                  ? LucideIcons.link
                  : LucideIcons.unlink,
              size: 20,
              color: failing
                  ? warning
                  : c.connected
                  ? green
                  : colors.mutedForeground,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 2,
              children: [
                Text(
                  c.network.label,
                  style: theme.textTheme.p.copyWith(
                    fontWeight: FontWeight.w700,
                    height: 1.3,
                  ),
                ),
                Text(
                  status,
                  style: theme.textTheme.muted.copyWith(
                    fontSize: 13,
                    height: 1.35,
                  ),
                ),
                if (c.lastError case final error?)
                  Text(
                    error,
                    style: theme.textTheme.muted.copyWith(
                      fontSize: 13,
                      height: 1.35,
                      fontWeight: FontWeight.w600,
                      color: warning,
                    ),
                  ),
              ],
            ),
          ),
          if (c.connected)
            ShadButton.outline(
              size: ShadButtonSize.sm,
              enabled: !busy,
              onPressed: busy ? null : onDisconnect,
              child: const Text('Déconnecter'),
            )
          else if (c.available)
            ShadButton(
              size: ShadButtonSize.sm,
              enabled: !busy,
              onPressed: busy ? null : onConnect,
              child: const Text('Connecter'),
            )
          else
            // Not offered yet: an outline in full text colour, so it stays
            // readable once dimmed.
            ShadButton.outline(
              size: ShadButtonSize.sm,
              enabled: false,
              foregroundColor: colors.foreground,
              child: const Text('Connecter'),
            ),
        ],
      ),
    );
  }
}
