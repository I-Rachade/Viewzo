import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../wallet_models.dart';
import 'accounts_screen.dart';
import 'login_screen.dart';
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
                    _open(AccountsScreen(api: api, phone: user.phone)),
                onSkills: () =>
                    _open(SkillsScreen(api: api, country: user.country)),
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
  });
  final UserView user;
  final ApiClient api;
  final String? error;
  final ValueChanged<ProfileType> onActivate;
  final VoidCallback onWallet;
  final VoidCallback onCampaigns;

  @override
  State<_HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<_HomeTab> {
  WalletSummary? _wallet;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  Future<void> _loadWallet() async {
    try {
      final wallet = await widget.api.wallet();
      if (mounted) setState(() => _wallet = wallet);
    } catch (_) {
      // The balance card simply stays hidden.
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
        onRefresh: _loadWallet,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            FadeSlideIn(
              index: i++,
              child: Row(
                spacing: 12,
                children: [
                  const VzMark(size: 40),
                  Text(
                    hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour',
                    style: text.headlineSmall,
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
    required this.onLogout,
  });
  final UserView user;
  final VoidCallback onAccounts;
  final VoidCallback onSkills;
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

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        children: [
          Text('Profil', style: text.headlineSmall),
          const SizedBox(height: 4),
          Text(user.phone, style: text.bodyMedium),
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
          ],
          tile(
            2,
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
