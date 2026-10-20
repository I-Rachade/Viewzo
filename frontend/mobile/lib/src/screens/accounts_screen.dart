import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../creator_models.dart';
import '../ui/widgets.dart';

/// "Mes comptes": the creator's networks and where each one is in verification.
class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key, required this.api, required this.phone});
  final ApiClient api;
  // Prefills the WhatsApp Statut number.
  final String phone;

  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  List<SocialAccount>? _accounts;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => _run(() async {
    final accounts = await widget.api.accounts();
    setState(() => _accounts = accounts);
  });

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _error = null);
    try {
      await action();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Serveur injoignable');
    }
  }

  Future<void> _add() async {
    final taken = {for (final a in _accounts ?? <SocialAccount>[]) a.network};
    final added = await showModalBottomSheet<(SocialNetwork, String)>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _AddAccountSheet(
        available: [
          for (final n in SocialNetwork.values)
            if (!taken.contains(n)) n,
        ],
        phone: widget.phone,
      ),
    );
    if (added == null) return;
    await _run(() async {
      await widget.api.addAccount(added.$1, added.$2);
      await _load();
    });
  }

  Future<void> _resubmit(SocialAccount account) => _run(() async {
    await widget.api.resubmitAccount(account.id);
    await _load();
  });

  Future<void> _remove(SocialAccount account) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Retirer ${account.network.label} ?'),
        content: const Text(
          'Tu ne recevras plus de tâches pour ce réseau. '
          'Si tu le rajoutes, il repassera en vérification.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Annuler'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Retirer'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _run(() async {
      await widget.api.removeAccount(account.id);
      await _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final accounts = _accounts;
    return Scaffold(
      appBar: AppBar(title: const Text('Mes comptes')),
      floatingActionButton: accounts == null
          ? null
          : FloatingActionButton.extended(
              onPressed: accounts.length == SocialNetwork.values.length
                  ? null
                  : _add,
              icon: const Icon(Icons.add),
              label: const Text('Ajouter un réseau'),
            ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            if (accounts == null && _error == null)
              const SkeletonList(count: 2),
            if (accounts != null && accounts.isEmpty)
              const Text(
                'Choisis les réseaux sur lesquels tu veux publier. '
                'Un seul suffit pour commencer.',
              ),
            for (final account in accounts ?? <SocialAccount>[])
              _AccountCard(
                account: account,
                onResubmit: () => _resubmit(account),
                onRemove: () => _remove(account),
              ),
          ],
        ),
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({
    required this.account,
    required this.onResubmit,
    required this.onRemove,
  });
  final SocialAccount account;
  final VoidCallback onResubmit;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final verification = account.verification;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 8,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    account.network.label,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                _StatusChip(status: account.status),
              ],
            ),
            Text(account.handle),
            ..._statusDetails(),
            if (verification != null) _VerificationSteps(verification),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (account.canRemove)
                  TextButton(onPressed: onRemove, child: const Text('Retirer')),
                if (account.canResubmit)
                  FilledButton(
                    onPressed: onResubmit,
                    child: const Text('Relancer la vérification'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _statusDetails() {
    final reason = account.statusReason;
    switch (account.status) {
      case AccountStatus.pending:
        return [
          if (account.reviewDueAt != null)
            Text('Réponse au plus tard le ${_day(account.reviewDueAt!)}'),
        ];
      case AccountStatus.eligible:
        return [const Text('Tu reçois des tâches pour ce réseau.')];
      case AccountStatus.needsFix:
        return [Text('À faire : ${reason ?? 'voir le support'}')];
      case AccountStatus.notEligible:
        return [
          if (reason != null) Text('Raison : $reason'),
          if (account.retryAfter != null)
            Text('Nouvel essai possible le ${_day(account.retryAfter!)}'),
        ];
      case AccountStatus.suspended:
        return [
          if (reason != null) Text('Motif : $reason'),
          const Text('Pour contester, contacte le support Viewzo.'),
        ];
    }
  }
}

String _day(DateTime date) =>
    '${date.day.toString().padLeft(2, '0')}/'
    '${date.month.toString().padLeft(2, '0')}/${date.year}';

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final AccountStatus status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (status) {
      AccountStatus.eligible => (
        scheme.primaryContainer,
        scheme.onPrimaryContainer,
      ),
      AccountStatus.pending => (
        scheme.secondaryContainer,
        scheme.onSecondaryContainer,
      ),
      AccountStatus.needsFix => (
        scheme.tertiaryContainer,
        scheme.onTertiaryContainer,
      ),
      AccountStatus.notEligible || AccountStatus.suspended => (
        scheme.errorContainer,
        scheme.onErrorContainer,
      ),
    };
    return Chip(
      label: Text(status.label, style: TextStyle(color: foreground)),
      backgroundColor: background,
      side: BorderSide.none,
      visualDensity: VisualDensity.compact,
    );
  }
}

class _VerificationSteps extends StatelessWidget {
  const _VerificationSteps(this.verification);
  final Verification verification;

  @override
  Widget build(BuildContext context) {
    final code = Row(
      children: [
        SelectableText(
          verification.code,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        IconButton(
          tooltip: 'Copier le code',
          icon: const Icon(Icons.copy, size: 18),
          onPressed: () =>
              Clipboard.setData(ClipboardData(text: verification.code)),
        ),
      ],
    );
    if (!verification.isWhatsapp) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Ajoute ce code dans la bio de ton compte :'),
          code,
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Text(
          '1. Enregistre le numéro Viewzo ${verification.contactNumber} '
          'dans tes contacts.',
        ),
        const Text('2. Envoie-lui le message de vérification avec ton code :'),
        code,
        Wrap(
          spacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: () => Clipboard.setData(
                ClipboardData(text: verification.contactNumber ?? ''),
              ),
              icon: const Icon(Icons.person_add_alt),
              label: const Text('Copier le numéro'),
            ),
            FilledButton.icon(
              onPressed: () => launchUrl(
                Uri.parse(verification.whatsappLink!),
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.send),
              label: const Text('Envoyer sur WhatsApp'),
            ),
          ],
        ),
        const Text(
          "3. Un agent Viewzo t'enregistre à son tour pour voir tes statuts.",
        ),
      ],
    );
  }
}

class _AddAccountSheet extends StatefulWidget {
  const _AddAccountSheet({required this.available, required this.phone});
  final List<SocialNetwork> available;
  final String phone;

  @override
  State<_AddAccountSheet> createState() => _AddAccountSheetState();
}

class _AddAccountSheetState extends State<_AddAccountSheet> {
  late SocialNetwork _network = widget.available.first;
  final _handle = TextEditingController();

  @override
  void initState() {
    super.initState();
    _prefill();
  }

  void _prefill() {
    _handle.text = _network == SocialNetwork.whatsappStatus ? widget.phone : '';
  }

  @override
  void dispose() {
    _handle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isWhatsapp = _network == SocialNetwork.whatsappStatus;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        24,
        24,
        24 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 16,
        children: [
          Text(
            'Ajouter un réseau',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          DropdownButtonFormField<SocialNetwork>(
            key: const Key('network'),
            initialValue: _network,
            decoration: const InputDecoration(labelText: 'Réseau'),
            items: [
              for (final n in widget.available)
                DropdownMenuItem(value: n, child: Text(n.label)),
            ],
            onChanged: (n) => setState(() {
              _network = n!;
              _prefill();
            }),
          ),
          TextField(
            key: const Key('handle'),
            controller: _handle,
            keyboardType: isWhatsapp ? TextInputType.phone : TextInputType.url,
            decoration: InputDecoration(
              labelText: isWhatsapp
                  ? 'Numéro WhatsApp'
                  : 'Pseudo ou lien du profil',
            ),
          ),
          FilledButton(
            onPressed: () {
              final handle = _handle.text.trim();
              if (handle.length < 2) return;
              Navigator.pop(context, (_network, handle));
            },
            child: const Text('Ajouter'),
          ),
        ],
      ),
    );
  }
}
