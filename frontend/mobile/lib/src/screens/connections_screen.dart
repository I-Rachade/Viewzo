import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../creator_models.dart';
import '../task_models.dart';
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
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Comptes connectés')),
      body: items == null && _error == null
          ? const SkeletonList()
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Connecte tes comptes : Viewzo relève lui-même les vues de '
                  'tes publications, sans capture d’écran, et ta validation '
                  'va plus vite.',
                ),
                const SizedBox(height: 12),
                if (_error != null)
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                for (final c in items ?? const <Connection>[])
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      title: Text(c.network.label),
                      subtitle: Text(
                        [
                          c.connected
                              ? 'Connecté${c.handle != null ? ' : ${c.handle}' : ''}'
                              : c.available
                              ? 'Non connecté'
                              : 'Bientôt disponible',
                          ?c.lastError,
                        ].join('\n'),
                      ),
                      trailing: c.connected
                          ? OutlinedButton(
                              onPressed: _busy
                                  ? null
                                  : () => _disconnect(c.network),
                              child: const Text('Déconnecter'),
                            )
                          : FilledButton(
                              onPressed: _busy || !c.available
                                  ? null
                                  : () => _connect(c.network),
                              child: const Text('Connecter'),
                            ),
                    ),
                  ),
                const SizedBox(height: 8),
                Text(
                  'YouTube, X et Telegram n’ont pas besoin de connexion : '
                  'leurs vues sont publiques. Pour un statut WhatsApp, envoie '
                  'tes captures dans Mes tâches.',
                  style: text.bodySmall,
                ),
              ],
            ),
    );
  }
}
