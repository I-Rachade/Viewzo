import 'package:flutter/material.dart';

import '../api_client.dart';
import '../task_models.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// What happened to the creator's posts, accounts and money. Opening the
/// screen marks everything read.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.api, this.onOpen});
  final ApiClient api;

  /// Opens the screen a notification is about (its link).
  final ValueChanged<String>? onOpen;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<AppNotification>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final (unread, items) = await widget.api.notifications();
      if (!mounted) return;
      setState(() => _items = items);
      if (unread > 0) await widget.api.readNotifications();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Serveur injoignable');
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: items == null
          ? (_error == null
                ? const SkeletonList()
                : Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (items.isEmpty)
                    const Text('Rien de nouveau pour l’instant.'),
                  for (final (i, n) in items.indexed)
                    FadeSlideIn(
                      index: i,
                      child: Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        clipBehavior: Clip.antiAlias,
                        child: ListTile(
                          leading: n.read
                              ? const Icon(Icons.notifications_none_rounded)
                              : const Icon(
                                  Icons.notifications_active_rounded,
                                  color: VzColors.coral,
                                ),
                          title: Text(n.title),
                          subtitle: Text(
                            '${n.body}\n${_when(n.createdAt)}',
                            style: text.bodySmall,
                          ),
                          isThreeLine: true,
                          onTap: n.link == null || widget.onOpen == null
                              ? null
                              : () => widget.onOpen!(n.link!),
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

String _when(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} '
    'à ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
