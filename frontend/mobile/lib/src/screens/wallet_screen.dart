import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../wallet_models.dart';
import 'identity_screen.dart';

/// The wallet shared by all profiles: balances, history, top-up, withdrawal.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

enum _Filter { all, incoming, outgoing }

class _WalletScreenState extends State<WalletScreen> {
  WalletSummary? _summary;
  List<WalletTransaction> _history = [];
  String? _error;
  _Filter _filter = _Filter.all;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _verifyIdentity() async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => IdentityScreen(api: widget.api)));
    if (mounted) await _load();
  }

  Future<void> _load() => _run(() async {
    final summary = await widget.api.wallet();
    final history = await widget.api.walletTransactions();
    setState(() {
      _summary = summary;
      _history = history;
    });
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

  Future<void> _deposit() async {
    final amount = await showShadDialog<int>(
      context: context,
      builder: (_) => const _AmountDialog(
        title: 'Recharger par Mobile Money',
        minimum: 500,
      ),
    );
    if (amount == null) return;
    await _run(() async {
      final payment = await widget.api.deposit(amount);
      if (payment.checkoutUrl != null) {
        await launchUrl(
          Uri.parse(payment.checkoutUrl!),
          mode: LaunchMode.externalApplication,
        );
      }
    });
  }

  Future<void> _withdraw(WalletSummary summary) async {
    final request = await showShadSheet<_WithdrawRequest>(
      context: context,
      side: ShadSheetSide.bottom,
      builder: (_) => _WithdrawSheet(summary: summary),
    );
    if (request == null) return;
    await _run(() async {
      await widget.api.withdraw(
        amount: request.amount,
        beneficiaryName: request.name,
        operator: request.operator,
      );
      await _load();
      if (mounted) {
        showVzToast(context, 'Demande envoyée, l’équipe Viewzo la valide');
      }
    });
  }

  List<WalletTransaction> get _shown => switch (_filter) {
    _Filter.all => _history,
    _Filter.incoming => [
      for (final t in _history)
        if (t.amount > 0) t,
    ],
    _Filter.outgoing => [
      for (final t in _history)
        if (t.amount < 0) t,
    ],
  };

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    final theme = ShadTheme.of(context);
    final week = _lastSevenDays(_history);
    final shown = _shown;
    return Scaffold(
      appBar: AppBar(title: const Text('Mon portefeuille')),
      body: summary == null
          ? Center(
              child: _error == null
                  ? const SkeletonList(count: 2)
                  : Text(_error!),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  FadeSlideIn(
                    child: _BalanceCard(
                      summary: summary,
                      onWithdraw:
                          summary.withdrawalsOpen &&
                              summary.available >= summary.minWithdrawal
                          ? () => _withdraw(summary)
                          : null,
                      onDeposit: _deposit,
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (!summary.withdrawalsOpen)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const ShadAlert(
                            icon: Icon(LucideIcons.lock),
                            title: Text('Retraits fermés pour l’instant'),
                            description: Text(
                              'Les retraits s’ouvrent au niveau 2, après la '
                              'vérification de ton identité : une pièce et '
                              'un selfie, en quelques minutes.',
                            ),
                          ),
                          const SizedBox(height: 8),
                          ShadButton.outline(
                            onPressed: _verifyIdentity,
                            leading: const Icon(LucideIcons.idCard, size: 16),
                            child: const Text('Vérifier mon identité'),
                          ),
                        ],
                      ),
                    ),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: ShadAlert.destructive(
                        icon: const Icon(LucideIcons.circleAlert),
                        title: Text(_error!),
                      ),
                    ),
                  if (week.any((v) => v > 0)) ...[
                    FadeSlideIn(index: 1, child: _WeekChart(days: week)),
                    const SizedBox(height: 12),
                  ],
                  const ShadAlert(
                    icon: Icon(LucideIcons.calendarClock),
                    description: Text(
                      'Les gains du mois deviennent disponibles le 1er du mois suivant.',
                    ),
                  ),
                  const SizedBox(height: 28),
                  Row(
                    children: [
                      Expanded(
                        child: Text('Historique', style: theme.textTheme.h4),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _FilterBar(
                    value: _filter,
                    onChanged: (f) => setState(() => _filter = f),
                  ),
                  const SizedBox(height: 12),
                  if (shown.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Text(
                        'Aucune opération pour l’instant.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.muted,
                      ),
                    )
                  else
                    FadeSlideIn(
                      index: 2,
                      child: ShadCard(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Column(
                          children: [
                            for (final (i, t) in shown.indexed) ...[
                              if (i > 0)
                                const ShadSeparator.horizontal(
                                  margin: EdgeInsets.only(left: 56),
                                ),
                              _TransactionTile(t),
                            ],
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

/// All, money in, money out: a segmented control in the iOS manner.
class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.value, required this.onChanged});
  final _Filter value;
  final ValueChanged<_Filter> onChanged;

  static const _labels = {
    _Filter.all: 'Tout',
    _Filter.incoming: 'Entrées',
    _Filter.outgoing: 'Sorties',
  };

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: colors.muted,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          for (final f in _Filter.values)
            Expanded(
              child: Semantics(
                button: true,
                selected: f == value,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onChanged(f),
                  child: AnimatedContainer(
                    duration: VzMotion.of(context, VzMotion.standard),
                    curve: VzMotion.easeOut,
                    height: 36,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: f == value ? colors.card : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                      boxShadow: f == value
                          ? const [
                              BoxShadow(
                                color: Color(0x14000000),
                                blurRadius: 8,
                                offset: Offset(0, 2),
                              ),
                            ]
                          : null,
                    ),
                    child: Text(
                      _labels[f]!,
                      style: theme.textTheme.small.copyWith(
                        fontWeight: FontWeight.w700,
                        color: f == value
                            ? colors.foreground
                            : colors.mutedForeground,
                      ),
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

/// Earnings per day over the last seven days, oldest first.
List<int> _lastSevenDays(List<WalletTransaction> history) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final days = List.filled(7, 0);
  for (final t in history) {
    if (t.type != 'EARNING' || t.amount <= 0) continue;
    final d = t.createdAt;
    final age = today.difference(DateTime(d.year, d.month, d.day)).inDays;
    if (age >= 0 && age < 7) days[6 - age] += t.amount;
  }
  return days;
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({
    required this.summary,
    required this.onWithdraw,
    required this.onDeposit,
  });
  final WalletSummary summary;
  final VoidCallback? onWithdraw;
  final VoidCallback onDeposit;

  @override
  Widget build(BuildContext context) {
    final text = ShadTheme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [VzColors.ink, Color(0xFF262040)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x335B3DF5),
            blurRadius: 32,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                LucideIcons.wallet,
                size: 18,
                color: VzColors.mutedDark,
              ),
              const SizedBox(width: 8),
              Text(
                'Disponible',
                style: text.small.copyWith(color: VzColors.mutedDark),
              ),
            ],
          ),
          const SizedBox(height: 8),
          AnimatedCount(
            value: summary.available,
            format: formatFcfa,
            style: text.h1.copyWith(color: Colors.white, fontSize: 34),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _DarkBadge(
                'En attente',
                formatFcfa(summary.held),
                color: const Color(0xFFFFD27A),
              ),
              if (summary.escrow > 0)
                _DarkBadge(
                  'Séquestre',
                  formatFcfa(summary.escrow),
                  color: const Color(0xFFC9BEFF),
                ),
              if (summary.pendingWithdrawals > 0)
                _DarkBadge(
                  'Retraits en cours',
                  formatFcfa(summary.pendingWithdrawals),
                  color: const Color(0xFFC9BEFF),
                ),
            ],
          ),
          const SizedBox(height: 20),
          Row(
            spacing: 12,
            children: [
              Expanded(
                child: ShadButton(
                  width: double.infinity,
                  enabled: onWithdraw != null,
                  onPressed: onWithdraw,
                  backgroundColor: VzColors.coral,
                  hoverBackgroundColor: const Color(0xFFFF8080),
                  pressedBackgroundColor: const Color(0xFFF25A5A),
                  foregroundColor: VzColors.ink,
                  leading: const Icon(LucideIcons.arrowUpRight, size: 18),
                  child: const Flexible(
                    child: Text('Retirer', overflow: TextOverflow.ellipsis),
                  ),
                ),
              ),
              Expanded(
                // A translucent button with the theme's radius, like Retirer.
                child: ShadButton(
                  width: double.infinity,
                  onPressed: onDeposit,
                  backgroundColor: const Color(0x1FFFFFFF),
                  hoverBackgroundColor: const Color(0x2EFFFFFF),
                  pressedBackgroundColor: const Color(0x2EFFFFFF),
                  foregroundColor: Colors.white,
                  hoverForegroundColor: Colors.white,
                  pressedForegroundColor: Colors.white,
                  leading: const Icon(LucideIcons.plus, size: 18),
                  child: const Flexible(
                    child: Text('Recharger', overflow: TextOverflow.ellipsis),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A label and an amount on the dark balance card.
class _DarkBadge extends StatelessWidget {
  const _DarkBadge(this.label, this.amount, {required this.color});
  final String label;
  final String amount;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: const Color(0x14FFFFFF),
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: '$label  ',
            style: const TextStyle(color: VzColors.mutedDark),
          ),
          TextSpan(
            text: amount,
            style: TextStyle(color: color, fontWeight: FontWeight.w700),
          ),
        ],
      ),
      style: const TextStyle(fontSize: 12.5),
    ),
  );
}

class _WeekChart extends StatelessWidget {
  const _WeekChart({required this.days});
  final List<int> days;

  // Two letters, so Mardi and Mercredi can't be confused.
  static const _letters = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    final max = days.reduce((a, b) => a > b ? a : b);
    final total = days.fold(0, (a, b) => a + b);
    final today = DateTime.now().weekday % 7;
    final duration = VzMotion.of(context, VzMotion.bounce);
    final dark = theme.brightness == Brightness.dark;
    return ShadCard(
      title: Text(
        'Gains des 7 derniers jours',
        style: theme.textTheme.p.copyWith(
          fontWeight: FontWeight.w700,
          color: colors.mutedForeground,
        ),
      ),
      description: Text(
        '+${formatFcfa(total)}',
        style: theme.textTheme.h3.copyWith(
          color: dark ? const Color(0xFF7BE0B0) : VzColors.paidText,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Semantics(
          label: 'Gains par jour sur les 7 derniers jours',
          child: SizedBox(
            height: 120,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              spacing: 10,
              children: [
                for (final (i, v) in days.indexed)
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      spacing: 8,
                      children: [
                        TweenAnimationBuilder<double>(
                          tween: Tween(begin: 0, end: max == 0 ? 0 : v / max),
                          duration: duration + VzMotion.stagger * i,
                          curve: VzMotion.spring,
                          builder: (context, f, _) => Container(
                            height: 4 + 80 * f.clamp(0, 1.2),
                            decoration: BoxDecoration(
                              color: i == 6
                                  ? VzColors.coral
                                  : colors.primary.withValues(
                                      alpha: i == 6 ? 1 : 0.85,
                                    ),
                              borderRadius: BorderRadius.circular(6),
                            ),
                          ),
                        ),
                        Text(
                          _letters[(today - 6 + i) % 7],
                          style: theme.textTheme.muted.copyWith(
                            fontSize: 12,
                            fontWeight: i == 6 ? FontWeight.w700 : null,
                            color: i == 6 ? colors.foreground : null,
                          ),
                        ),
                      ],
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

String _date(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

class _TransactionTile extends StatelessWidget {
  const _TransactionTile(this.t);
  final WalletTransaction t;

  @override
  Widget build(BuildContext context) {
    final details = [
      _date(t.createdAt),
      if (t.status == 'CANCELLED') 'annulé',
      if (t.type == 'EARNING' && t.availableAt.isAfter(DateTime.now()))
        'disponible le ${_date(t.availableAt)}',
    ];
    final positive = t.amount > 0;
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    final dark = theme.brightness == Brightness.dark;
    final green = dark ? const Color(0xFF7BE0B0) : VzColors.paidText;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 14,
        children: [
          Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: positive ? const Color(0x221FA971) : colors.secondary,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              positive ? LucideIcons.arrowDownLeft : LucideIcons.arrowUpRight,
              size: 20,
              color: positive ? green : colors.primary,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 2,
              children: [
                Row(
                  spacing: 8,
                  children: [
                    Flexible(
                      child: Text(
                        t.label,
                        style: theme.textTheme.p.copyWith(
                          fontWeight: FontWeight.w700,
                          height: 1.3,
                        ),
                      ),
                    ),
                    if (t.status == 'PENDING')
                      const Pill('en attente', tone: PillTone.pending),
                  ],
                ),
                if (t.note != null)
                  Text(
                    t.note!,
                    style: theme.textTheme.small.copyWith(
                      fontWeight: FontWeight.w500,
                      height: 1.35,
                    ),
                  ),
                Text(
                  details.join(' · '),
                  style: theme.textTheme.muted.copyWith(
                    fontSize: 13,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          Text(
            '${positive ? '+' : ''}${formatFcfa(t.amount)}',
            style: TextStyle(
              fontFamily: 'Sora',
              fontWeight: FontWeight.w700,
              fontSize: 14,
              color: positive ? green : colors.foreground,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _AmountDialog extends StatefulWidget {
  const _AmountDialog({required this.title, required this.minimum});
  final String title;
  final int minimum;

  @override
  State<_AmountDialog> createState() => _AmountDialogState();
}

class _AmountDialogState extends State<_AmountDialog> {
  final _controller = TextEditingController();
  String? _error;

  static const _quick = [1000, 2000, 5000, 10000];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final amount = int.tryParse(_controller.text.trim().replaceAll(' ', ''));
    if (amount == null || amount < widget.minimum) {
      setState(() => _error = 'Minimum ${formatFcfa(widget.minimum)}');
      return;
    }
    Navigator.pop(context, amount);
  }

  @override
  Widget build(BuildContext context) => ShadDialog(
    title: Text(widget.title),
    description: const Text('Tu confirmes le paiement sur ton téléphone.'),
    actions: [
      ShadButton.outline(
        onPressed: () => Navigator.pop(context),
        child: const Text('Annuler'),
      ),
      ShadButton(onPressed: _send, child: const Text('Continuer')),
    ],
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 12,
        children: [
          ShadInputFormField(
            controller: _controller,
            keyboardType: TextInputType.number,
            autofocus: true,
            placeholder: const Text('Montant'),
            trailing: const Text('FCFA'),
            forceErrorText: _error,
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final q in _quick)
                ShadBadge.outline(
                  onPressed: () => setState(() {
                    _controller.text = '$q';
                    _error = null;
                  }),
                  child: Text(formatFcfa(q)),
                ),
            ],
          ),
        ],
      ),
    ),
  );
}

class _WithdrawRequest {
  _WithdrawRequest(this.amount, this.name, this.operator);
  final int amount;
  final String name;
  final String? operator;
}

class _WithdrawSheet extends StatefulWidget {
  const _WithdrawSheet({required this.summary});
  final WalletSummary summary;

  @override
  State<_WithdrawSheet> createState() => _WithdrawSheetState();
}

class _WithdrawSheetState extends State<_WithdrawSheet> {
  final _amount = TextEditingController();
  final _name = TextEditingController();
  String? _operator;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _name.dispose();
    super.dispose();
  }

  void _send() {
    final s = widget.summary;
    final amount = int.tryParse(_amount.text.trim().replaceAll(' ', ''));
    if (amount == null || amount < s.minWithdrawal || amount > s.available) {
      setState(
        () => _error =
            'Entre ${formatFcfa(s.minWithdrawal)} et ${formatFcfa(s.available)}',
      );
      return;
    }
    if (_name.text.trim().length < 3) {
      setState(() => _error = 'Indique le nom du compte Mobile Money');
      return;
    }
    if (s.operators.isNotEmpty && _operator == null) {
      setState(() => _error = 'Choisis ton opérateur');
      return;
    }
    Navigator.pop(
      context,
      _WithdrawRequest(amount, _name.text.trim(), _operator),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.summary;
    final theme = ShadTheme.of(context);
    return ShadSheet(
      title: const Text('Retirer mes gains'),
      description: Text(
        'Disponible : ${formatFcfa(s.available)}. Envoyé sur ton numéro '
        'Viewzo après validation.',
      ),
      actions: [
        ShadButton(
          size: ShadButtonSize.lg,
          width: double.infinity,
          onPressed: _send,
          leading: const Icon(LucideIcons.arrowUpRight, size: 18),
          child: const Flexible(
            child: Text('Demander le retrait', overflow: TextOverflow.ellipsis),
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
            ShadInputFormField(
              controller: _amount,
              keyboardType: TextInputType.number,
              label: const Text('Montant'),
              placeholder: Text(formatFcfa(s.minWithdrawal)),
              trailing: const Text('FCFA'),
            ),
            ShadInputFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              label: const Text('Nom du compte Mobile Money'),
              placeholder: const Text('Comme sur ta pièce d’identité'),
            ),
            if (s.operators.isNotEmpty) ...[
              Text('Opérateur', style: theme.textTheme.small),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final o in s.operators)
                    _OperatorChoice(
                      label: o,
                      selected: _operator == o,
                      onTap: () => setState(() => _operator = o),
                    ),
                ],
              ),
            ],
            if (_error != null)
              ShadAlert.destructive(
                icon: const Icon(LucideIcons.circleAlert),
                title: Text(_error!),
              ),
          ],
        ),
      ),
    );
  }
}

class _OperatorChoice extends StatelessWidget {
  const _OperatorChoice({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = ShadTheme.of(context).colorScheme;
    return ShadButton.raw(
      variant: selected
          ? ShadButtonVariant.secondary
          : ShadButtonVariant.outline,
      onPressed: onTap,
      leading: Icon(
        selected ? LucideIcons.circleCheck : LucideIcons.smartphone,
        size: 18,
        color: selected ? colors.primary : colors.mutedForeground,
      ),
      decoration: selected
          ? ShadDecoration(
              border: ShadBorder.all(color: colors.primary, width: 1.5),
            )
          : null,
      child: Text(label),
    );
  }
}
