import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../features.dart';
import '../session.dart';
import '../task_models.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../wallet_models.dart';
import 'accounts_screen.dart';
import 'auth_widgets.dart';
import 'connections_screen.dart';
import 'login_screen.dart';
import 'notifications_screen.dart';
import 'phone_required_screen.dart';
import 'skills_screen.dart';
import 'tasks_screen.dart';
import 'wallet_screen.dart';

/// The signed-in app: four tabs under a bar whose highlight slides.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.session, this.initialUser});
  final Session session;
  final UserView? initialUser;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>
    with SingleTickerProviderStateMixin {
  UserView? _user;
  String? _error;
  bool _offline = false;
  int _tab = 0;
  int _unread = 0;
  // Tabs are built the first time they are opened, then kept.
  final _opened = <int>{0};
  late final _fade = AnimationController(
    vsync: this,
    duration: VzMotion.wide,
    value: 1,
  );

  @override
  void initState() {
    super.initState();
    _user = widget.initialUser;
    if (_user == null) _load();
    _loadUnread();
  }

  Future<void> _loadUnread() async {
    try {
      final unread = await widget.session.api.unreadNotifications();
      if (mounted) setState(() => _unread = unread);
    } catch (_) {
      // The bell simply shows no count.
    }
  }

  Future<void> _openNotifications() async {
    final api = widget.session.api;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NotificationsScreen(
          api: api,
          onOpen: (link) {
            Navigator.of(context).pop();
            switch (link) {
              case '/taches' || '/resultats':
                _select(1);
              case '/wallet':
                _select(2);
              case '/comptes':
                _open(AccountsScreen(api: api, phone: _user?.phone ?? ''));
            }
          },
        ),
      ),
    );
    _loadUnread();
  }

  @override
  void dispose() {
    _fade.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _offline = false);
    try {
      final user = await widget.session.api.me();
      setState(() => _user = user);
    } on ApiException catch (e) {
      // Only an ended session leads back to the login screen.
      if (e.statusCode == 401) return _logout();
      if (mounted) setState(() => _offline = true);
    } catch (_) {
      // No network: keep the session and offer to try again.
      if (mounted) setState(() => _offline = true);
    }
  }

  Future<void> _activate(ProfileType type) async {
    try {
      final user = await widget.session.api.activateProfile(type);
      setState(() => _user = user);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<void> _addContact(IdentifierKind kind) async {
    final user = await showShadDialog<UserView>(
      context: context,
      builder: (_) => _AddContactDialog(api: widget.session.api, kind: kind),
    );
    if (user != null) setState(() => _user = user);
  }

  void _open(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  void _select(int tab) {
    if (tab == _tab) return;
    setState(() {
      _tab = tab;
      _opened.add(tab);
    });
    if (VzMotion.of(context, VzMotion.wide) == Duration.zero) return;
    _fade.forward(from: 0);
  }

  Future<void> _logout() async {
    await widget.session.clear();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => LoginScreen(session: widget.session)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = _user;
    if (user == null && _offline) {
      final theme = ShadTheme.of(context);
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  LucideIcons.wifiOff,
                  size: 32,
                  color: theme.colorScheme.mutedForeground,
                ),
                const SizedBox(height: 16),
                Text(
                  'Impossible de joindre Viewzo. Vérifie ta connexion.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.p,
                ),
                const SizedBox(height: 20),
                ShadButton(
                  onPressed: _load,
                  leading: const Icon(LucideIcons.refreshCw, size: 18),
                  child: const Text('Réessayer'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final api = widget.session.api;
    if (user.phoneRequired) {
      return PhoneRequiredScreen(
        api: api,
        user: user,
        onVerified: (user) => setState(() => _user = user),
        onLogout: _logout,
      );
    }
    final creator = user.profiles.any((p) => p.type == ProfileType.creator);
    Widget lazy(int tab, Widget Function() build) =>
        _opened.contains(tab) ? build() : const SizedBox.shrink();

    return Scaffold(
      body: FadeTransition(
        opacity: CurvedAnimation(parent: _fade, curve: VzMotion.easeOut),
        child: IndexedStack(
          index: _tab,
          children: [
            _HomeTab(
              user: user,
              api: api,
              error: _error,
              onActivate: _activate,
              onWallet: () => _select(2),
              onCampaigns: () => _select(1),
              unread: _unread,
              onNotifications: _openNotifications,
            ),
            lazy(
              1,
              () => creator
                  ? TasksScreen(api: api)
                  : _BecomeCreator(
                      onActivate: () => _activate(ProfileType.creator),
                    ),
            ),
            lazy(2, () => WalletScreen(api: api)),
            lazy(
              3,
              () => _ProfileTab(
                user: user,
                onAccounts: () =>
                    _open(AccountsScreen(api: api, phone: user.phone ?? '')),
                onSkills: () =>
                    _open(SkillsScreen(api: api, country: user.country)),
                onConnections: () => _open(ConnectionsScreen(api: api)),
                onAddContact: _addContact,
                onLogout: _logout,
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: _TabBar(index: _tab, onSelect: _select),
    );
  }
}

/// The bottom bar in the iOS manner: a hairline on top, line icons, and the
/// brand colour on the chosen tab, over a soft highlight that slides.
class _TabBar extends StatelessWidget {
  const _TabBar({required this.index, required this.onSelect});
  final int index;
  final ValueChanged<int> onSelect;

  static const _tabs = [
    (LucideIcons.house, 'Accueil'),
    (LucideIcons.megaphone, 'Campagnes'),
    (LucideIcons.wallet, 'Portefeuille'),
    (LucideIcons.userRound, 'Profil'),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = ShadTheme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.card,
        border: Border(top: BorderSide(color: colors.border, width: 0.5)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
          child: SizedBox(
            height: 54,
            child: Stack(
              children: [
                // The highlight slides under the chosen tab with a spring.
                AnimatedAlign(
                  alignment: Alignment(-1 + index * 2 / 3, 0),
                  duration: VzMotion.of(context, VzMotion.wide),
                  curve: VzMotion.spring,
                  child: FractionallySizedBox(
                    widthFactor: 1 / 4,
                    heightFactor: 1,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: colors.secondary,
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                  ),
                ),
                Row(
                  children: [
                    for (final (i, (icon, label)) in _tabs.indexed)
                      Expanded(
                        child: Semantics(
                          selected: i == index,
                          button: true,
                          child: GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => onSelect(i),
                            child: Pressable(
                              scale: 0.92,
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                spacing: 3,
                                children: [
                                  Icon(
                                    icon,
                                    size: 22,
                                    color: i == index
                                        ? colors.primary
                                        : colors.mutedForeground,
                                  ),
                                  Text(
                                    label,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: i == index
                                          ? FontWeight.w700
                                          : FontWeight.w500,
                                      color: i == index
                                          ? colors.primary
                                          : colors.mutedForeground,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One row of a grouped list: an icon tile, a title, an optional subtitle
/// and whatever sits on the right. Dims slightly while pressed.
class _Row extends StatefulWidget {
  const _Row({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.iconColor,
    this.iconBackground,
  });
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? iconColor;
  final Color? iconBackground;

  @override
  State<_Row> createState() => _RowState();
}

class _RowState extends State<_Row> {
  bool _down = false;

  void _set(bool down) {
    if (_down != down) setState(() => _down = down);
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    final row = AnimatedOpacity(
      opacity: _down ? 0.55 : 1,
      duration: VzMotion.of(context, VzMotion.fast),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: LayoutBuilder(
          builder: (context, constraints) => Row(
            spacing: 14,
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: widget.iconBackground ?? colors.secondary,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(
                  widget.icon,
                  size: 19,
                  color: widget.iconColor ?? colors.primary,
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 2,
                  children: [
                    Text(
                      widget.title,
                      style: theme.textTheme.p.copyWith(
                        fontWeight: FontWeight.w600,
                        height: 1.3,
                      ),
                    ),
                    if (widget.subtitle != null)
                      Text(
                        widget.subtitle!,
                        style: theme.textTheme.muted.copyWith(
                          fontSize: 13,
                          height: 1.35,
                        ),
                      ),
                  ],
                ),
              ),
              // The trailing action never takes more than about half the row.
              if (widget.trailing case final trailing?)
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxWidth: constraints.maxWidth * 0.5,
                  ),
                  child: trailing,
                ),
            ],
          ),
        ),
      ),
    );
    if (widget.onTap == null) return row;
    return Semantics(
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _set(true),
        onTapUp: (_) => _set(false),
        onTapCancel: () => _set(false),
        onTap: widget.onTap,
        child: row,
      ),
    );
  }
}

/// A chevron, for rows that open another screen.
class _Chevron extends StatelessWidget {
  const _Chevron();

  @override
  Widget build(BuildContext context) => Icon(
    LucideIcons.chevronRight,
    size: 18,
    color: ShadTheme.of(context).colorScheme.mutedForeground,
  );
}

/// Rows grouped in one card, with hairlines between them.
class _Group extends StatelessWidget {
  const _Group({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => ShadCard(
    padding: const EdgeInsets.symmetric(horizontal: 16),
    child: Column(
      children: [
        for (final (i, child) in children.indexed) ...[
          if (i > 0)
            const ShadSeparator.horizontal(margin: EdgeInsets.only(left: 52)),
          child,
        ],
      ],
    ),
  );
}

class _HomeTab extends StatefulWidget {
  const _HomeTab({
    required this.user,
    required this.api,
    required this.error,
    required this.onActivate,
    required this.onWallet,
    required this.onCampaigns,
    required this.unread,
    required this.onNotifications,
  });
  final UserView user;
  final ApiClient api;
  final String? error;
  final ValueChanged<ProfileType> onActivate;
  final VoidCallback onWallet;
  final VoidCallback onCampaigns;
  final int unread;
  final VoidCallback onNotifications;

  @override
  State<_HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<_HomeTab> {
  WalletSummary? _wallet;
  List<CampaignTask>? _tasks;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() => Future.wait([_loadWallet(), _loadTasks()]);

  Future<void> _loadWallet() async {
    try {
      final wallet = await widget.api.wallet();
      if (mounted) setState(() => _wallet = wallet);
    } catch (_) {
      // The balance card simply stays hidden.
    }
  }

  Future<void> _loadTasks() async {
    if (!widget.user.profiles.any((p) => p.type == ProfileType.creator)) {
      return;
    }
    try {
      final tasks = await widget.api.availableTasks();
      if (mounted) setState(() => _tasks = tasks);
    } catch (_) {
      // The preview simply stays hidden.
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.user;
    final theme = ShadTheme.of(context);
    final hour = DateTime.now().hour;
    final creator = user.profiles.any((p) => p.type == ProfileType.creator);
    final wallet = _wallet;
    var i = 0;

    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: [
            FadeSlideIn(
              index: i++,
              child: Row(
                spacing: 12,
                children: [
                  VzMark(size: 40, outline: VzMark.outlineFor(context)),
                  Expanded(
                    child: Text(
                      hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour',
                      style: theme.textTheme.h3,
                    ),
                  ),
                  _Bell(
                    unread: widget.unread,
                    onPressed: widget.onNotifications,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            if (wallet != null) ...[
              FadeSlideIn(
                index: i++,
                child: _WalletCard(wallet: wallet, onWallet: widget.onWallet),
              ),
              const SizedBox(height: 16),
            ],
            FadeSlideIn(
              index: i++,
              child: ShadCard(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 10,
                  children: [
                    Text(
                      'Tu es inscrit n° ${user.priorityRank} (${user.country})',
                      style: theme.textTheme.p.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (user.isFounder) const Pill('Badge Fondateur'),
                  ],
                ),
              ),
            ),
            if (creator) ...[
              const SizedBox(height: 12),
              FadeSlideIn(
                index: i++,
                child: Pressable(
                  scale: 0.98,
                  child: ShadCard(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: _Row(
                      icon: LucideIcons.megaphone,
                      iconColor: VzColors.ink,
                      iconBackground: VzColors.coral,
                      title: 'Campagnes pour toi',
                      subtitle: 'Publie et sois payé à la vue',
                      trailing: const _Chevron(),
                      onTap: widget.onCampaigns,
                    ),
                  ),
                ),
              ),
              for (final task
                  in (_tasks ?? const <CampaignTask>[])
                      .where((t) => !t.locked)
                      .take(3))
                FadeSlideIn(
                  index: i++,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _TaskPreview(task: task, onTap: widget.onCampaigns),
                  ),
                ),
            ],
            const SizedBox(height: 28),
            Text('Mes profils', style: theme.textTheme.h4),
            const SizedBox(height: 12),
            FadeSlideIn(
              index: i++,
              child: _Group(
                children: [
                  for (final type in ProfileType.values)
                    _profileRow(user, type),
                ],
              ),
            ),
            if (widget.error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: ShadAlert.destructive(
                  icon: const Icon(LucideIcons.circleAlert),
                  title: Text(widget.error!),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _profileRow(UserView user, ProfileType type) {
    final profile = user.profiles.where((p) => p.type == type).firstOrNull;
    final colors = ShadTheme.of(context).colorScheme;
    final dark = ShadTheme.of(context).brightness == Brightness.dark;
    if (profile != null) {
      return _Row(
        icon: LucideIcons.circleCheck,
        iconColor: dark ? const Color(0xFF7BE0B0) : VzColors.paidText,
        iconBackground: const Color(0x221FA971),
        title: type.label,
        subtitle: 'Niveau ${profile.level}',
      );
    }
    return _Row(
      icon: LucideIcons.circlePlus,
      iconColor: colors.mutedForeground,
      iconBackground: colors.muted,
      title: type.label,
      trailing: ShadButton.secondary(
        size: ShadButtonSize.sm,
        onPressed: () => widget.onActivate(type),
        child: const Flexible(
          child: Text('Activer', overflow: TextOverflow.ellipsis),
        ),
      ),
    );
  }
}

/// The bell, with the number of unread notifications on a coral dot.
class _Bell extends StatelessWidget {
  const _Bell({required this.unread, required this.onPressed});
  final int unread;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = ShadTheme.of(context).colorScheme;
    return Semantics(
      label: 'Notifications',
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          ShadIconButton.outline(
            onPressed: onPressed,
            width: 44,
            height: 44,
            decoration: ShadDecoration(
              border: ShadBorder.all(
                color: colors.border,
                radius: BorderRadius.circular(99),
              ),
            ),
            backgroundColor: colors.card,
            icon: const Icon(LucideIcons.bell, size: 20),
          ),
          if (unread > 0)
            Positioned(
              top: -2,
              right: -2,
              child: IgnorePointer(
                child: Container(
                  constraints: const BoxConstraints(minWidth: 18),
                  height: 18,
                  padding: const EdgeInsets.symmetric(horizontal: 5),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: VzColors.coral,
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(color: colors.background, width: 2),
                  ),
                  child: Text(
                    '$unread',
                    style: const TextStyle(
                      color: VzColors.ink,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      height: 1,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One open campaign on the home screen; the full brief is in Campagnes.
class _TaskPreview extends StatelessWidget {
  const _TaskPreview({required this.task, required this.onTap});
  final CampaignTask task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final dark = theme.brightness == Brightness.dark;
    return Pressable(
      scale: 0.98,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: ShadCard(
          padding: const EdgeInsets.all(14),
          child: Row(
            spacing: 12,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 6,
                  children: [
                    Text(
                      task.brief.title,
                      style: theme.textTheme.p.copyWith(
                        fontWeight: FontWeight.w700,
                        height: 1.3,
                      ),
                    ),
                    Wrap(
                      spacing: 10,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Pill(task.network.label, tone: PillTone.paid),
                        Text(
                          '${task.ratePer1000} F / 1 000 vues',
                          style: TextStyle(
                            fontFamily: 'Sora',
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                            color: dark
                                ? const Color(0xFF7BE0B0)
                                : VzColors.paidText,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const _Chevron(),
            ],
          ),
        ),
      ),
    );
  }
}

class _WalletCard extends StatelessWidget {
  const _WalletCard({required this.wallet, required this.onWallet});
  final WalletSummary wallet;
  final VoidCallback onWallet;

  @override
  Widget build(BuildContext context) {
    final text = ShadTheme.of(context).textTheme;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: VzColors.violet,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x335B3DF5),
            blurRadius: 32,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        children: [
          const Positioned(
            right: -46,
            top: -46,
            child: Opacity(
              opacity: 0.18,
              child: VzMark(size: 170, tile: false, draw: 0),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 10,
              children: [
                const Text(
                  'Solde disponible',
                  style: TextStyle(color: Color(0xFFE4DEFF), fontSize: 13),
                ),
                AnimatedCount(
                  value: wallet.available,
                  format: formatFcfa,
                  style: text.h2.copyWith(color: Colors.white),
                ),
                if (wallet.held > 0)
                  Text(
                    'En attente : ${formatFcfa(wallet.held)}',
                    style: const TextStyle(color: Color(0xFFE4DEFF)),
                  ),
                const SizedBox(height: 4),
                Pressable(
                  child: ShadButton(
                    width: double.infinity,
                    height: 46,
                    backgroundColor: Colors.white,
                    hoverBackgroundColor: const Color(0xFFF2EFFF),
                    pressedBackgroundColor: const Color(0xFFE9E4FF),
                    foregroundColor: VzColors.violet,
                    hoverForegroundColor: VzColors.violet,
                    pressedForegroundColor: VzColors.violet,
                    decoration: ShadDecoration(
                      border: ShadBorder(radius: BorderRadius.circular(99)),
                    ),
                    onPressed: onWallet,
                    leading: const Icon(LucideIcons.arrowUpRight, size: 18),
                    child: const Flexible(
                      child: Text(
                        'Retirer vers Mobile Money',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BecomeCreator extends StatelessWidget {
  const _BecomeCreator({required this.onActivate});
  final VoidCallback onActivate;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 20,
          children: [
            VzMark(size: 72, outline: VzMark.outlineFor(context)),
            Text(
              'Active ton profil créateur pour recevoir des campagnes payées '
              'à la vue.',
              textAlign: TextAlign.center,
              style: ShadTheme.of(context).textTheme.lead,
            ),
            ShadButton(
              size: ShadButtonSize.lg,
              width: double.infinity,
              onPressed: onActivate,
              leading: const Icon(LucideIcons.sparkles, size: 18),
              child: const Flexible(
                child: Text(
                  'Devenir créateur',
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _ProfileTab extends StatelessWidget {
  const _ProfileTab({
    required this.user,
    required this.onAccounts,
    required this.onSkills,
    required this.onConnections,
    required this.onAddContact,
    required this.onLogout,
  });
  final UserView user;
  final VoidCallback onAccounts;
  final VoidCallback onSkills;
  final VoidCallback onConnections;
  final ValueChanged<IdentifierKind> onAddContact;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    final creator = user.profiles.any((p) => p.type == ProfileType.creator);
    Widget tile(
      int i,
      IconData icon,
      String title,
      String sub,
      VoidCallback on, {
      bool destructive = false,
    }) => FadeSlideIn(
      index: i,
      child: _Row(
        icon: icon,
        iconColor: destructive ? colors.destructive : null,
        iconBackground: destructive
            ? colors.destructive.withValues(alpha: 0.12)
            : null,
        title: title,
        subtitle: sub,
        trailing: const _Chevron(),
        onTap: on,
      ),
    );

    Widget contact(
      IconData icon,
      String? value,
      String addLabel,
      IdentifierKind kind,
    ) => _Row(
      icon: icon,
      iconColor: value == null ? colors.mutedForeground : null,
      iconBackground: value == null ? colors.muted : null,
      title: value ?? 'Non renseigné',
      trailing: value == null
          ? ShadButton.link(
              size: ShadButtonSize.sm,
              padding: EdgeInsets.zero,
              onPressed: () => onAddContact(kind),
              child: Flexible(
                child: Text(addLabel, overflow: TextOverflow.ellipsis),
              ),
            )
          : null,
    );

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          Text('Profil', style: theme.textTheme.h3),
          const SizedBox(height: 24),
          Text('E-mail et téléphone', style: theme.textTheme.h4),
          const SizedBox(height: 12),
          FadeSlideIn(
            child: _Group(
              children: [
                contact(
                  LucideIcons.mail,
                  user.email,
                  'Ajouter un e-mail',
                  IdentifierKind.email,
                ),
                contact(
                  LucideIcons.phone,
                  user.phone,
                  'Ajouter un numéro',
                  IdentifierKind.phone,
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          if (creator) ...[
            _Group(
              children: [
                tile(
                  0,
                  LucideIcons.shieldCheck,
                  'Mes comptes',
                  'Réseaux et vérification',
                  onAccounts,
                ),
                tile(
                  1,
                  LucideIcons.sparkles,
                  'Mes compétences',
                  'Ce que tu sais faire',
                  onSkills,
                ),
                // Hidden while creators add their accounts by hand.
                if (oauthConnections)
                  tile(
                    2,
                    LucideIcons.link,
                    'Comptes connectés',
                    'Tes vues relevées automatiquement',
                    onConnections,
                  ),
              ],
            ),
            const SizedBox(height: 24),
          ],
          _Group(
            children: [
              tile(
                3,
                LucideIcons.logOut,
                'Se déconnecter',
                'Sur ce téléphone',
                onLogout,
                destructive: true,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Asks for the missing e-mail or number, sends it a code and confirms it.
/// Pops with the refreshed user once verified.
class _AddContactDialog extends StatefulWidget {
  const _AddContactDialog({required this.api, required this.kind});
  final ApiClient api;
  final IdentifierKind kind;

  @override
  State<_AddContactDialog> createState() => _AddContactDialogState();
}

class _AddContactDialogState extends State<_AddContactDialog>
    with CodeFormState<_AddContactDialog> {
  final _identifier = TextEditingController();
  final _code = TextEditingController();

  bool get _email => widget.kind == IdentifierKind.email;

  Future<void> _request() => run(() async {
    final identifier = _identifier.text.trim();
    final to = await widget.api.contactRequest(identifier);
    codeSent(to, identifier);
  });

  Future<void> _verify() => run(() async {
    final user = await widget.api.contactVerify(sentInput!, _code.text.trim());
    if (mounted) Navigator.of(context).pop(user);
  });

  @override
  void dispose() {
    _identifier.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final entering = sentTo != null;
    final theme = ShadTheme.of(context);
    return ShadDialog(
      title: Text(_email ? 'Ajouter un e-mail' : 'Ajouter un numéro'),
      actions: [
        ShadButton.outline(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Annuler'),
        ),
        ShadButton(
          enabled: !busy,
          onPressed: busy ? null : (entering ? _verify : _request),
          child: Text(entering ? 'Valider' : 'Recevoir un code'),
        ),
      ],
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!entering)
              ShadInputFormField(
                key: const Key('contact'),
                controller: _identifier,
                keyboardType: _email
                    ? TextInputType.emailAddress
                    : TextInputType.phone,
                label: Text(_email ? 'Adresse e-mail' : 'Numéro de téléphone'),
                placeholder: Text(
                  _email ? 'nom@exemple.com' : '+228 90 12 34 56',
                ),
              )
            else ...[
              Text('Code envoyé à $sentTo', style: theme.textTheme.p),
              const SizedBox(height: 8),
              Text(codeHint, style: theme.textTheme.muted),
              const SizedBox(height: 12),
              CodeField(controller: _code),
              resendButton(_request),
            ],
            errorText(),
          ],
        ),
      ),
    );
  }
}
