import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
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
    final added = await showShadSheet<(SocialNetwork, String)>(
      context: context,
      side: ShadSheetSide.bottom,
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
    final confirmed = await showShadDialog<bool>(
      context: context,
      builder: (context) => ShadDialog.alert(
        title: Text('Retirer ${account.network.label} ?'),
        description: const Text(
          'Tu ne recevras plus de tâches pour ce réseau. '
          'Si tu le rajoutes, il repassera en vérification.',
        ),
        actions: [
          ShadButton.outline(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Annuler'),
          ),
          ShadButton.destructive(
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
    final theme = ShadTheme.of(context);
    final full = accounts?.length == SocialNetwork.values.length;
    return Scaffold(
      appBar: AppBar(title: const Text('Mes comptes')),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      floatingActionButton: accounts == null
          ? null
          : ShadButton(
              size: ShadButtonSize.lg,
              enabled: !full,
              onPressed: full ? null : _add,
              shadows: const [
                BoxShadow(
                  color: Color(0x335B3DF5),
                  blurRadius: 24,
                  offset: Offset(0, 8),
                ),
              ],
              leading: const Icon(LucideIcons.plus, size: 18),
              child: const Flexible(
                child: Text(
                  'Ajouter un réseau',
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 112),
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: ShadAlert.destructive(
                  icon: const Icon(LucideIcons.circleAlert),
                  title: Text(_error!),
                ),
              ),
            if (accounts == null && _error == null)
              const SkeletonList(count: 2),
            if (accounts != null && accounts.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  'Choisis les réseaux sur lesquels tu veux publier. '
                  'Un seul suffit pour commencer.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.muted,
                ),
              ),
            for (final (i, account) in (accounts ?? <SocialAccount>[]).indexed)
              FadeSlideIn(
                index: i,
                child: _AccountCard(
                  account: account,
                  onResubmit: () => _resubmit(account),
                  onRemove: () => _remove(account),
                ),
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
    final theme = ShadTheme.of(context);
    final verification = account.verification;
    final details = _statusDetails();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: ShadCard(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              spacing: 12,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 2,
                    children: [
                      Text(account.network.label, style: theme.textTheme.large),
                      Text(account.handle, style: theme.textTheme.muted),
                    ],
                  ),
                ),
                Pill(account.status.label, tone: _tone(account.status)),
              ],
            ),
            if (details.isNotEmpty) ...[
              const SizedBox(height: 12),
              DefaultTextStyle.merge(
                style: theme.textTheme.small.copyWith(
                  fontWeight: FontWeight.w500,
                  height: 1.4,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 4,
                  children: details,
                ),
              ),
            ],
            if (verification != null) ...[
              const SizedBox(height: 16),
              _VerificationSteps(verification),
            ],
            if (account.canRemove || account.canResubmit) ...[
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (account.canRemove)
                      ShadButton.ghost(
                        onPressed: onRemove,
                        child: const Text('Retirer'),
                      ),
                    if (account.canResubmit)
                      ShadButton(
                        onPressed: onResubmit,
                        leading: const Icon(LucideIcons.refreshCw, size: 16),
                        child: const Flexible(
                          child: Text(
                            'Relancer la vérification',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
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

PillTone _tone(AccountStatus status) => switch (status) {
  AccountStatus.eligible => PillTone.paid,
  AccountStatus.pending => PillTone.violet,
  AccountStatus.needsFix => PillTone.pending,
  AccountStatus.notEligible || AccountStatus.suspended => PillTone.refused,
};

class _VerificationSteps extends StatelessWidget {
  const _VerificationSteps(this.verification);
  final Verification verification;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    final code = Container(
      padding: const EdgeInsets.fromLTRB(14, 4, 4, 4),
      decoration: BoxDecoration(
        color: colors.muted,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: SelectableText(
              verification.code,
              style: theme.textTheme.large.copyWith(
                fontFamily: 'Sora',
                letterSpacing: 1,
              ),
            ),
          ),
          Semantics(
            label: 'Copier le code',
            button: true,
            child: ShadIconButton.ghost(
              icon: const Icon(LucideIcons.copy, size: 18),
              onPressed: () =>
                  Clipboard.setData(ClipboardData(text: verification.code)),
            ),
          ),
        ],
      ),
    );
    final step = theme.textTheme.small.copyWith(
      fontWeight: FontWeight.w500,
      height: 1.4,
    );
    if (!verification.isWhatsapp) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 8,
        children: [
          Text('Ajoute ce code dans la bio de ton compte :', style: step),
          code,
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 10,
      children: [
        Text(
          '1. Enregistre le numéro Viewzo ${verification.contactNumber} '
          'dans tes contacts.',
          style: step,
        ),
        Text(
          '2. Envoie-lui le message de vérification avec ton code :',
          style: step,
        ),
        code,
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            ShadButton.outline(
              onPressed: () => Clipboard.setData(
                ClipboardData(text: verification.contactNumber ?? ''),
              ),
              leading: const Icon(LucideIcons.userPlus, size: 16),
              child: const Flexible(
                child: Text(
                  'Copier le numéro',
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
            ShadButton(
              onPressed: () => launchUrl(
                Uri.parse(verification.whatsappLink!),
                mode: LaunchMode.externalApplication,
              ),
              leading: const Icon(LucideIcons.send, size: 16),
              child: const Flexible(
                child: Text(
                  'Envoyer sur WhatsApp',
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
        ),
        Text(
          "3. Un agent Viewzo t'enregistre à son tour pour voir tes statuts.",
          style: step,
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
    return ShadSheet(
      title: const Text('Ajouter un réseau'),
      actions: [
        ShadButton(
          size: ShadButtonSize.lg,
          width: double.infinity,
          onPressed: () {
            final handle = _handle.text.trim();
            if (handle.length < 2) return;
            Navigator.pop(context, (_network, handle));
          },
          child: const Flexible(
            child: Text('Ajouter', overflow: TextOverflow.ellipsis),
          ),
        ),
      ],
      child: Padding(
        padding: EdgeInsets.only(
          top: 8,
          bottom: 8 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 14,
          children: [
            ShadSelectFormField<SocialNetwork>(
              key: const Key('network'),
              label: const Text('Réseau'),
              initialValue: _network,
              options: [
                for (final n in widget.available)
                  ShadOption(value: n, child: Text(n.label)),
              ],
              selectedOptionBuilder: (context, n) => Text(n.label),
              onChanged: (n) => setState(() {
                _network = n!;
                _prefill();
              }),
            ),
            ShadInputFormField(
              key: const Key('handle'),
              controller: _handle,
              keyboardType: isWhatsapp
                  ? TextInputType.phone
                  : TextInputType.url,
              label: Text(
                isWhatsapp ? 'Numéro WhatsApp' : 'Pseudo ou lien du profil',
              ),
            ),
          ],
        ),
      ),
    );
  }
}
