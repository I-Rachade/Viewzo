import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

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
    final theme = ShadTheme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: items == null
          ? (_error == null
                ? const SkeletonList()
                : Padding(
                    padding: const EdgeInsets.all(16),
                    child: ShadAlert.destructive(
                      icon: const Icon(LucideIcons.circleAlert),
                      title: Text(_error!),
                    ),
                  ))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  if (items.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 48),
                      child: Column(
                        spacing: 12,
                        children: [
                          Icon(
                            LucideIcons.bell,
                            size: 32,
                            color: theme.colorScheme.mutedForeground,
                          ),
                          Text(
                            'Rien de nouveau pour l’instant.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.muted,
                          ),
                        ],
                      ),
                    )
                  else
                    ShadCard(
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: [
                          for (final (i, n) in items.indexed) ...[
                            if (i > 0)
                              const ShadSeparator.horizontal(
                                margin: EdgeInsets.only(left: 72),
                              ),
                            FadeSlideIn(
                              index: i,
                              child: _NotificationTile(
                                n,
                                onTap: n.link == null || widget.onOpen == null
                                    ? null
                                    : () => widget.onOpen!(n.link!),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile(this.n, {required this.onTap});
  final AppNotification n;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    final row = Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 14,
        children: [
          Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: n.read
                  ? colors.secondary
                  : VzColors.coral.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              n.read ? LucideIcons.bell : LucideIcons.bellRing,
              size: 20,
              color: n.read ? colors.mutedForeground : VzColors.coral,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 2,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 8,
                  children: [
                    Flexible(
                      child: Text(
                        n.title,
                        style: theme.textTheme.p.copyWith(
                          fontWeight: n.read
                              ? FontWeight.w400
                              : FontWeight.w700,
                          height: 1.3,
                        ),
                      ),
                    ),
                    // Unread: a coral dot after the bold title.
                    if (!n.read)
                      Semantics(
                        label: 'Non lue',
                        child: Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(top: 7),
                          decoration: const BoxDecoration(
                            color: VzColors.coral,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                  ],
                ),
                Text(
                  n.body,
                  style: theme.textTheme.small.copyWith(
                    fontWeight: FontWeight.w400,
                    height: 1.4,
                    color: n.read ? colors.mutedForeground : null,
                  ),
                ),
                Text(
                  _when(n.createdAt),
                  style: theme.textTheme.muted.copyWith(
                    fontSize: 12.5,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          if (onTap != null)
            Padding(
              padding: const EdgeInsets.only(top: 11),
              child: Icon(
                LucideIcons.chevronRight,
                size: 18,
                color: colors.mutedForeground,
              ),
            ),
        ],
      ),
    );
    if (onTap == null) return row;
    return Semantics(
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Pressable(scale: 0.98, child: row),
      ),
    );
  }
}

String _when(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} '
    'à ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
