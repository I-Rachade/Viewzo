import 'package:flutter/material.dart';

import '../api_client.dart';
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
    try {
      final user = await widget.session.api.me();
      setState(() => _user = user);
    } catch (_) {
      await _logout();
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
    final user = await showDialog<UserView>(
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
    if (user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final api = widget.session.api;
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

class _TabBar extends StatelessWidget {
  const _TabBar({required this.index, required this.onSelect});
  final int index;
  final ValueChanged<int> onSelect;

  static const _tabs = [
    (Icons.home_rounded, 'Accueil'),
    (Icons.campaign_rounded, 'Campagnes'),
    (Icons.account_balance_wallet_rounded, 'Portefeuille'),
    (Icons.person_rounded, 'Profil'),
  ];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(top: BorderSide(color: scheme.outline)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: SizedBox(
            height: 56,
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
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: scheme.primaryContainer,
                        borderRadius: BorderRadius.circular(16),
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
                          child: InkWell(
                            borderRadius: BorderRadius.circular(16),
                            onTap: () => onSelect(i),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              spacing: 2,
                              children: [
                                Icon(
                                  icon,
                                  size: 22,
                                  color: i == index
                                      ? scheme.primary
                                      : scheme.onSurfaceVariant,
                                ),
                                Text(
                                  label,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: i == index
                                        ? FontWeight.w700
                                        : FontWeight.w500,
                                    color: i == index
                                        ? scheme.primary
                                        : scheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
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
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final hour = DateTime.now().hour;
    final creator = user.profiles.any((p) => p.type == ProfileType.creator);
    final wallet = _wallet;
    var i = 0;

    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            FadeSlideIn(
              index: i++,
              child: Row(
                spacing: 12,
                children: [
                  const VzMark(size: 40),
                  Expanded(
                    child: Text(
                      hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour',
                      style: text.headlineSmall,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Notifications',
                    onPressed: widget.onNotifications,
                    icon: Badge(
                      isLabelVisible: widget.unread > 0,
                      label: Text('${widget.unread}'),
                      backgroundColor: VzColors.coral,
                      child: const Icon(Icons.notifications_none_rounded),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            if (wallet != null) ...[
              FadeSlideIn(
                index: i++,
                child: _WalletCard(wallet: wallet, onWallet: widget.onWallet),
              ),
              const SizedBox(height: 16),
            ],
            FadeSlideIn(
              index: i++,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 8,
                    children: [
                      Text(
                        'Tu es inscrit n° ${user.priorityRank} (${user.country})',
                        style: text.titleMedium,
                      ),
                      if (user.isFounder) const Pill('Badge Fondateur'),
                    ],
                  ),
                ),
              ),
            ),
            if (creator) ...[
              const SizedBox(height: 12),
              FadeSlideIn(
                index: i++,
                child: Pressable(
                  scale: 0.98,
                  child: Card(
                    clipBehavior: Clip.antiAlias,
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 6,
                      ),
                      leading: Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: VzColors.coral,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Icon(
                          Icons.campaign_rounded,
                          color: VzColors.ink,
                        ),
                      ),
                      title: const Text(
                        'Campagnes pour toi',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: const Text('Publie et sois payé à la vue'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: widget.onCampaigns,
                    ),
                  ),
                ),
              ),
              for (final task in (_tasks ?? const <CampaignTask>[]).take(3))
                FadeSlideIn(
                  index: i++,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _TaskPreview(task: task, onTap: widget.onCampaigns),
                  ),
                ),
            ],
            const SizedBox(height: 24),
            Text('Mes profils', style: text.titleMedium),
            const SizedBox(height: 8),
            for (final type in ProfileType.values)
              FadeSlideIn(index: i++, child: _profileTile(user, type)),
            if (widget.error != null)
              Text(widget.error!, style: TextStyle(color: scheme.error)),
          ],
        ),
      ),
    );
  }

  Widget _profileTile(UserView user, ProfileType type) {
    final profile = user.profiles.where((p) => p.type == type).firstOrNull;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: profile != null
            ? ListTile(
                leading: Icon(
                  Icons.check_circle_rounded,
                  color: scheme.tertiary,
                ),
                title: Text(type.label),
                subtitle: Text('Niveau ${profile.level}'),
              )
            : ListTile(
                leading: const Icon(Icons.add_circle_outline_rounded),
                title: Text(type.label),
                trailing: TextButton(
                  onPressed: () => widget.onActivate(type),
                  child: const Text('Activer'),
                ),
              ),
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Pressable(
      scale: 0.98,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 6,
                    children: [
                      Text(
                        task.brief.title,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      Pill(task.network.label, tone: PillTone.paid),
                    ],
                  ),
                ),
                Text(
                  '${task.ratePer1000} F / 1 000 vues',
                  style: TextStyle(
                    fontFamily: 'Sora',
                    fontWeight: FontWeight.w700,
                    color: dark ? const Color(0xFF7BE0B0) : VzColors.paidText,
                  ),
                ),
              ],
            ),
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
    final text = Theme.of(context).textTheme;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: VzColors.violet,
        borderRadius: BorderRadius.circular(24),
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
                  style: text.headlineMedium?.copyWith(color: Colors.white),
                ),
                if (wallet.held > 0)
                  Text(
                    'En attente : ${formatFcfa(wallet.held)}',
                    style: const TextStyle(color: Color(0xFFE4DEFF)),
                  ),
                const SizedBox(height: 2),
                Pressable(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: VzColors.violet,
                      shape: const StadiumBorder(),
                      minimumSize: const Size(0, 44),
                    ),
                    onPressed: onWallet,
                    child: const Text('Retirer vers Mobile Money'),
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
          spacing: 16,
          children: [
            const VzMark(size: 72),
            Text(
              'Active ton profil créateur pour recevoir des campagnes payées '
              'à la vue.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            FilledButton(
              onPressed: onActivate,
              child: const Text('Devenir créateur'),
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
    final text = Theme.of(context).textTheme;
    final creator = user.profiles.any((p) => p.type == ProfileType.creator);
    Widget tile(
      int i,
      IconData icon,
      String title,
      String sub,
      VoidCallback on,
    ) => FadeSlideIn(
      index: i,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Card(
          clipBehavior: Clip.antiAlias,
          child: ListTile(
            leading: Icon(icon),
            title: Text(title),
            subtitle: Text(sub),
            trailing: const Icon(Icons.chevron_right),
            onTap: on,
          ),
        ),
      ),
    );

    Widget contact(
      IconData icon,
      String? value,
      String addLabel,
      IdentifierKind kind,
    ) => ListTile(
      leading: Icon(icon),
      title: Text(value ?? 'Non renseigné'),
      trailing: value == null
          ? TextButton(
              onPressed: () => onAddContact(kind),
              child: Text(addLabel),
            )
          : null,
    );

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        children: [
          Text('Profil', style: text.headlineSmall),
          const SizedBox(height: 20),
          Text('E-mail et téléphone', style: text.titleMedium),
          const SizedBox(height: 8),
          FadeSlideIn(
            child: Card(
              child: Column(
                children: [
                  contact(
                    Icons.mail_outline,
                    user.email,
                    'Ajouter un e-mail',
                    IdentifierKind.email,
                  ),
                  contact(
                    Icons.phone_outlined,
                    user.phone,
                    'Ajouter un numéro',
                    IdentifierKind.phone,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          if (creator) ...[
            tile(
              0,
              Icons.verified_user_outlined,
              'Mes comptes',
              'Réseaux et vérification',
              onAccounts,
            ),
            tile(
              1,
              Icons.auto_awesome_outlined,
              'Mes compétences',
              'Ce que tu sais faire',
              onSkills,
            ),
            tile(
              2,
              Icons.link_rounded,
              'Comptes connectés',
              'Tes vues relevées automatiquement',
              onConnections,
            ),
          ],
          tile(
            3,
            Icons.logout_rounded,
            'Se déconnecter',
            'Sur ce téléphone',
            onLogout,
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
    return AlertDialog(
      title: Text(_email ? 'Ajouter un e-mail' : 'Ajouter un numéro'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!entering)
            TextField(
              key: const Key('contact'),
              controller: _identifier,
              keyboardType: _email
                  ? TextInputType.emailAddress
                  : TextInputType.phone,
              decoration: InputDecoration(
                labelText: _email ? 'Adresse e-mail' : 'Numéro de téléphone',
                hintText: _email ? 'nom@exemple.com' : '+228 90 12 34 56',
              ),
            )
          else ...[
            Text('Code envoyé à $sentTo'),
            const SizedBox(height: 8),
            Text(codeHint, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 8),
            CodeField(controller: _code),
            resendButton(_request),
          ],
          errorText(),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Annuler'),
        ),
        FilledButton(
          onPressed: busy ? null : (entering ? _verify : _request),
          child: Text(entering ? 'Valider' : 'Recevoir un code'),
        ),
      ],
    );
  }
}
