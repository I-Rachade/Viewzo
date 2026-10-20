import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import 'accounts_screen.dart';
import 'auth_widgets.dart';
import 'login_screen.dart';
import 'skills_screen.dart';
import 'tasks_screen.dart';
import 'wallet_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.session, this.initialUser});
  final Session session;
  final UserView? initialUser;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  UserView? _user;
  String? _error;

  @override
  void initState() {
    super.initState();
    _user = widget.initialUser;
    if (_user == null) _load();
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
    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/logo.png', width: 28, height: 28),
            const SizedBox(width: 10),
            const Text('Viewzo'),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Se déconnecter',
            icon: const Icon(Icons.logout),
            onPressed: _logout,
          ),
        ],
      ),
      body: user == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Text(
                  'Tu es inscrit n° ${user.priorityRank} (${user.country})',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                if (user.isFounder) ...[
                  const SizedBox(height: 8),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Chip(label: Text('Badge Fondateur')),
                  ),
                ],
                const SizedBox(height: 24),
                Text(
                  'E-mail et téléphone',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                _contactTile(
                  Icons.mail_outline,
                  user.email,
                  'Ajouter un e-mail',
                  IdentifierKind.email,
                ),
                _contactTile(
                  Icons.phone_outlined,
                  user.phone,
                  'Ajouter un numéro',
                  IdentifierKind.phone,
                ),
                const SizedBox(height: 24),
                Text(
                  'Mes profils',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                for (final type in ProfileType.values) _profileTile(user, type),
                const SizedBox(height: 16),
                ListTile(
                  leading: const Icon(Icons.account_balance_wallet_outlined),
                  title: const Text('Mon portefeuille'),
                  subtitle: const Text('Solde, gains et retraits'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _open(WalletScreen(api: widget.session.api)),
                ),
                if (user.profiles.any(
                  (p) => p.type == ProfileType.creator,
                )) ...[
                  const SizedBox(height: 24),
                  Text(
                    'Espace créateur',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  ListTile(
                    leading: const Icon(Icons.verified_user_outlined),
                    title: const Text('Mes comptes'),
                    subtitle: const Text('Réseaux et vérification'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _open(
                      AccountsScreen(
                        api: widget.session.api,
                        phone: user.phone ?? '',
                      ),
                    ),
                  ),
                  ListTile(
                    leading: const Icon(Icons.auto_awesome_outlined),
                    title: const Text('Mes compétences'),
                    subtitle: const Text('Ce que tu sais faire'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _open(
                      SkillsScreen(
                        api: widget.session.api,
                        country: user.country,
                      ),
                    ),
                  ),
                  ListTile(
                    leading: const Icon(Icons.task_alt_outlined),
                    title: const Text('Tâches'),
                    subtitle: const Text('Campagnes à publier'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _open(TasksScreen(api: widget.session.api)),
                  ),
                ],
                if (_error != null)
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
              ],
            ),
    );
  }

  Widget _contactTile(
    IconData icon,
    String? value,
    String addLabel,
    IdentifierKind kind,
  ) {
    return ListTile(
      dense: true,
      leading: Icon(icon),
      title: Text(value ?? 'Non renseigné'),
      trailing: value == null
          ? TextButton(
              onPressed: () => _addContact(kind),
              child: Text(addLabel),
            )
          : null,
    );
  }

  Widget _profileTile(UserView user, ProfileType type) {
    final profile = user.profiles.where((p) => p.type == type).firstOrNull;
    if (profile != null) {
      return ListTile(
        leading: const Icon(Icons.check_circle),
        title: Text(type.label),
        subtitle: Text('Niveau ${profile.level}'),
      );
    }
    return ListTile(
      leading: const Icon(Icons.add_circle_outline),
      title: Text(type.label),
      trailing: TextButton(
        onPressed: () => _activate(type),
        child: const Text('Activer'),
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
