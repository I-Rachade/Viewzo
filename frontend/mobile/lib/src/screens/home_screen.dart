import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import 'login_screen.dart';

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
        title: const Text('Viewzo'),
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
                  'Mes profils',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                for (final type in ProfileType.values) _profileTile(user, type),
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
