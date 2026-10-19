import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
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
                padding: const EdgeInsets.all(16),
                children: [
                  Text('Disponible', style: text.labelLarge),
                  Text(
                    formatFcfa(summary.available),
                    style: text.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      Chip(
                        label: Text('En attente : ${formatFcfa(summary.held)}'),
                      ),
                      if (summary.escrow > 0)
                        Chip(
                          label: Text(
                            'Séquestre : ${formatFcfa(summary.escrow)}',
                          ),
                        ),
                      if (summary.pendingWithdrawals > 0)
                        Chip(
                          label: Text(
                            'Retraits en cours : '
                            '${formatFcfa(summary.pendingWithdrawals)}',
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Les gains du mois deviennent disponibles le 1er du mois suivant.',
                  ),
                  const SizedBox(height: 16),
                  Row(
                    spacing: 12,
                    children: [
                      Expanded(
                        child: FilledButton(
                          onPressed:
                              summary.withdrawalsOpen &&
                                  summary.available >= summary.minWithdrawal
                              ? () => _withdraw(summary)
                              : null,
                          child: const Text('Retirer'),
                        ),
                      ),
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _deposit,
                          child: const Text('Recharger'),
                        ),
                      ),
                    ],
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
                  const SizedBox(height: 24),
                  Text('Historique', style: text.titleMedium),
                  if (_history.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text('Aucune opération pour l’instant.'),
                    ),
                  for (final t in _history) _TransactionTile(t),
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
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(t.label),
      subtitle: Text(details.join(' · ')),
      trailing: Text(
        '${t.amount > 0 ? '+' : ''}${formatFcfa(t.amount)}',
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: t.amount > 0 ? Colors.green.shade700 : null,
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
        16,
        16,
        16,
        16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 12,
        children: [
          Text('Retirer', style: Theme.of(context).textTheme.titleLarge),
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
            DropdownButtonFormField<String>(
              initialValue: _operator,
              decoration: const InputDecoration(labelText: 'Opérateur'),
              items: [
                for (final o in s.operators)
                  DropdownMenuItem(value: o, child: Text(o)),
              ],
              onChanged: (v) => setState(() => _operator = v),
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
