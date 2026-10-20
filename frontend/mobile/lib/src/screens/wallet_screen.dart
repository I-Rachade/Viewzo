import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../wallet_models.dart';

/// The wallet shared by all profiles: balances, history, top-up, withdrawal.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  WalletSummary? _summary;
  List<WalletTransaction> _history = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
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
    final amount = await showDialog<int>(
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
    final request = await showModalBottomSheet<_WithdrawRequest>(
      context: context,
      isScrollControlled: true,
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Demande envoyée, l’équipe Viewzo la valide'),
          ),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    final text = Theme.of(context).textTheme;
    final week = _lastSevenDays(_history);
    return Scaffold(
      appBar: AppBar(title: const Text('Mon portefeuille')),
      body: summary == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Text(_error!),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
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
                  Text(
                    'Les gains du mois deviennent disponibles le 1er du mois suivant.',
                    style: text.bodySmall,
                  ),
                  if (!summary.withdrawalsOpen)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text(
                        'Les retraits s’ouvrent au niveau 2, après la '
                        'vérification de ton identité.',
                      ),
                    ),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        _error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  if (week.any((v) => v > 0)) ...[
                    const SizedBox(height: 16),
                    FadeSlideIn(index: 1, child: _WeekChart(days: week)),
                  ],
                  const SizedBox(height: 24),
                  Text('Historique', style: text.titleMedium),
                  if (_history.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text('Aucune opération pour l’instant.'),
                    ),
                  for (final (i, t) in _history.indexed)
                    FadeSlideIn(index: i + 2, child: _TransactionTile(t)),
                ],
              ),
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
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: VzColors.ink,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 10,
        children: [
          Text(
            'Disponible',
            style: text.labelLarge?.copyWith(color: VzColors.mutedDark),
          ),
          AnimatedCount(
            value: summary.available,
            format: formatFcfa,
            style: text.headlineMedium?.copyWith(color: Colors.white),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Pill(
                'En attente : ${formatFcfa(summary.held)}',
                tone: PillTone.pending,
              ),
              if (summary.escrow > 0)
                Pill('Séquestre : ${formatFcfa(summary.escrow)}'),
              if (summary.pendingWithdrawals > 0)
                Pill(
                  'Retraits en cours : '
                  '${formatFcfa(summary.pendingWithdrawals)}',
                ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            spacing: 12,
            children: [
              Expanded(
                child: Pressable(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: VzColors.coral,
                      foregroundColor: VzColors.ink,
                      disabledBackgroundColor: VzColors.nightLine,
                      disabledForegroundColor: VzColors.mutedDark,
                    ),
                    onPressed: onWithdraw,
                    child: const Text('Retirer'),
                  ),
                ),
              ),
              Expanded(
                child: Pressable(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: VzColors.nightLine),
                    ),
                    onPressed: onDeposit,
                    child: const Text('Recharger'),
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

class _WeekChart extends StatelessWidget {
  const _WeekChart({required this.days});
  final List<int> days;

  static const _letters = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final max = days.reduce((a, b) => a > b ? a : b);
    final total = days.fold(0, (a, b) => a + b);
    final today = DateTime.now().weekday % 7;
    final duration = VzMotion.of(context, VzMotion.bounce);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 12,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Gains des 7 derniers jours',
                    style: text.titleSmall,
                  ),
                ),
                Text(
                  '+${formatFcfa(total)}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: VzColors.paidText,
                  ),
                ),
              ],
            ),
            Semantics(
              label: 'Gains par jour sur les 7 derniers jours',
              child: SizedBox(
                height: 130,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  spacing: 8,
                  children: [
                    for (final (i, v) in days.indexed)
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.end,
                          spacing: 6,
                          children: [
                            TweenAnimationBuilder<double>(
                              tween: Tween(
                                begin: 0,
                                end: max == 0 ? 0 : v / max,
                              ),
                              duration: duration + VzMotion.stagger * i,
                              curve: VzMotion.spring,
                              builder: (context, f, _) => Container(
                                height: 4 + 80 * f.clamp(0, 1.2),
                                decoration: BoxDecoration(
                                  color: i == 6
                                      ? VzColors.coral
                                      : scheme.primary,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                            ),
                            Text(
                              _letters[(today - 6 + i) % 7],
                              style: text.bodySmall,
                            ),
                          ],
                        ),
                      ),
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

String _date(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

class _TransactionTile extends StatelessWidget {
  const _TransactionTile(this.t);
  final WalletTransaction t;

  @override
  Widget build(BuildContext context) {
    final details = [
      _date(t.createdAt),
      if (t.status == 'PENDING') 'en attente',
      if (t.status == 'CANCELLED') 'annulé',
      if (t.type == 'EARNING' && t.availableAt.isAfter(DateTime.now()))
        'disponible le ${_date(t.availableAt)}',
      ?t.note,
    ];
    final positive = t.amount > 0;
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 40,
        height: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: positive ? const Color(0x221FA971) : scheme.primaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(
          positive ? Icons.south_west_rounded : Icons.north_east_rounded,
          size: 20,
          color: positive ? VzColors.paidText : scheme.primary,
        ),
      ),
      title: Text(t.label, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(details.join(' · ')),
      trailing: Text(
        '${positive ? '+' : ''}${formatFcfa(t.amount)}',
        style: TextStyle(
          fontFamily: 'Sora',
          fontWeight: FontWeight.w700,
          color: positive ? VzColors.paidText : null,
        ),
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

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final amount = int.tryParse(_controller.text.trim());
    if (amount == null || amount < widget.minimum) {
      setState(() => _error = 'Minimum ${formatFcfa(widget.minimum)}');
      return;
    }
    Navigator.pop(context, amount);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: TextField(
      controller: _controller,
      keyboardType: TextInputType.number,
      autofocus: true,
      decoration: InputDecoration(suffixText: 'FCFA', errorText: _error),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Annuler'),
      ),
      FilledButton(onPressed: _send, child: const Text('Continuer')),
    ],
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
    final amount = int.tryParse(_amount.text.trim());
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
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        0,
        20,
        24 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 12,
        children: [
          Text(
            'Retirer mes gains',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          TextField(
            controller: _amount,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              labelText: 'Montant',
              suffixText: 'FCFA',
              helperText: 'Disponible : ${formatFcfa(s.available)}',
            ),
          ),
          TextField(
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Nom du compte Mobile Money',
              helperText: 'Comme sur ta pièce d’identité',
            ),
          ),
          if (s.operators.isNotEmpty)
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final o in s.operators)
                  _OperatorChoice(
                    label: o,
                    selected: _operator == o,
                    onTap: () => setState(() => _operator = o),
                  ),
              ],
            ),
          const Text('Envoyé sur ton numéro Viewzo après validation.'),
          if (_error != null)
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          FilledButton(
            onPressed: _send,
            child: const Text('Demander le retrait'),
          ),
        ],
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
    final scheme = Theme.of(context).colorScheme;
    return Pressable(
      child: Material(
        color: selected ? scheme.primaryContainer : scheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color: selected ? scheme.primary : scheme.outline,
            width: selected ? 2 : 1,
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: AnimatedContainer(
            duration: VzMotion.of(context, VzMotion.standard),
            constraints: const BoxConstraints(minWidth: 120, minHeight: 52),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
          ),
        ),
      ),
    );
  }
}
