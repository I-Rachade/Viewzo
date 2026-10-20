import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../live_models.dart';
import '../ui/widgets.dart';
import '../wallet_models.dart';

// How often the live screen reads the live again while it runs.
const _pollEvery = Duration(seconds: 3);

PillTone _liveTone(String status) => switch (status) {
  'SCHEDULED' => PillTone.pending,
  'RUNNING' => PillTone.paid,
  'CANCELLED' => PillTone.refused,
  _ => PillTone.neutral,
};

PillTone _leadTone(String status) => switch (status) {
  'PAID' || 'DELIVERED' => PillTone.paid,
  'CANCELLED' => PillTone.refused,
  _ => PillTone.pending,
};

String _date(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)} à ${two(d.hour)}h${two(d.minute)}';
}

Widget _errorBox(String message) => Padding(
  padding: const EdgeInsets.all(16),
  child: ShadAlert.destructive(
    icon: const Icon(LucideIcons.circleAlert),
    title: Text(message),
  ),
);

String _message(Object e) => switch (e) {
  ApiException(code: 'MODULE_OFF') =>
    'La vente en live n’est pas disponible pour le moment.',
  ApiException(:final message) => message,
  _ => 'Serveur injoignable',
};

/// The seller's lives. The catalogue and the planning are on the web.
class LiveListScreen extends StatefulWidget {
  const LiveListScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<LiveListScreen> createState() => _LiveListScreenState();
}

class _LiveListScreenState extends State<LiveListScreen> {
  List<LiveSale>? _lives;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final lives = await widget.api.liveSales();
      if (mounted) setState(() => _lives = lives);
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    }
  }

  Future<void> _open(LiveSale live) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => LiveBoardScreen(api: widget.api, liveId: live.id),
      ),
    );
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final lives = _lives;
    return Scaffold(
      appBar: AppBar(title: const Text('Ventes en live')),
      body: lives == null
          ? (_error == null ? const SkeletonList() : _errorBox(_error!))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  Text(
                    'Ajoute ton catalogue et planifie tes lives sur viewzo.app. '
                    'Ici, tu commences le live et tu suis tes acheteurs.',
                    style: theme.textTheme.muted,
                  ),
                  const SizedBox(height: 16),
                  if (lives.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 48),
                      child: Text(
                        'Aucun live pour l’instant.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.muted,
                      ),
                    ),
                  for (final (i, live) in lives.indexed)
                    FadeSlideIn(
                      index: i,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: GestureDetector(
                          onTap: () => _open(live),
                          child: ShadCard(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              spacing: 6,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        live.title,
                                        style: theme.textTheme.p.copyWith(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    Pill(
                                      liveStatusLabels[live.status] ??
                                          live.status,
                                      tone: _liveTone(live.status),
                                    ),
                                  ],
                                ),
                                Text(
                                  '@${live.tiktokUsername} · ${_date(live.scheduledAt)}'
                                  '${live.demo ? ' · démo' : ''} · '
                                  '${live.leads} intéressé${live.leads > 1 ? 's' : ''}',
                                  style: theme.textTheme.muted,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

/// One live: start it, follow the buyers and their carts, then the summary.
class LiveBoardScreen extends StatefulWidget {
  const LiveBoardScreen({super.key, required this.api, required this.liveId});
  final ApiClient api;
  final String liveId;

  @override
  State<LiveBoardScreen> createState() => _LiveBoardScreenState();
}

class _LiveBoardScreenState extends State<LiveBoardScreen> {
  LiveBoard? _board;
  String? _error;
  bool _busy = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final board = await widget.api.liveBoard(widget.liveId);
      if (!mounted) return;
      setState(() {
        _board = board;
        _error = null;
      });
      _poll(board.live.running);
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    }
  }

  void _poll(bool on) {
    if (on && _timer == null) {
      _timer = Timer.periodic(_pollEvery, (_) => _load());
    } else if (!on) {
      _timer?.cancel();
      _timer = null;
    }
  }

  Future<void> _act(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _stop() async {
    final ok = await showShadDialog<bool>(
      context: context,
      builder: (context) => ShadDialog.alert(
        title: const Text('Terminer le live ?'),
        description: const Text(
          'Viewzo arrête de lire les commentaires et prépare le bilan.',
        ),
        actions: [
          ShadButton.outline(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Continuer'),
          ),
          ShadButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Terminer'),
          ),
        ],
      ),
    );
    if (ok == true) await _act(() => widget.api.stopLive(widget.liveId));
  }

  Future<void> _changeStatus(LiveLead lead) async {
    final status = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final MapEntry(:key, :value) in leadStatusLabels.entries)
              ListTile(
                title: Text(value),
                trailing: key == lead.status
                    ? const Icon(LucideIcons.check, size: 18)
                    : null,
                onTap: () => Navigator.of(context).pop(key),
              ),
          ],
        ),
      ),
    );
    if (status != null && status != lead.status) {
      await _act(
        () => widget.api.setLeadStatus(widget.liveId, lead.id, status),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final board = _board;
    if (board == null) {
      return Scaffold(
        appBar: AppBar(),
        body: _error == null ? const SkeletonList() : _errorBox(_error!),
      );
    }
    final theme = ShadTheme.of(context);
    final live = board.live;
    // Running, but nothing reads it any more (server restart, TikTok cut).
    final detached = live.running && !board.running;

    Widget stat(String label, String value) => Expanded(
      child: ShadCard(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 4,
          children: [
            Text(label, style: theme.textTheme.muted.copyWith(fontSize: 12)),
            Text(value, style: theme.textTheme.large),
          ],
        ),
      ),
    );

    return Scaffold(
      appBar: AppBar(title: Text(live.title)),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Row(
              spacing: 8,
              children: [
                Pill(
                  liveStatusLabels[live.status] ?? live.status,
                  tone: _liveTone(live.status),
                ),
                Expanded(
                  child: Text(
                    '@${live.tiktokUsername}'
                    '${live.viewers != null && live.running ? ' · ${live.viewers} spectateurs' : ''}',
                    style: theme.textTheme.muted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Lecture : ${board.ai ? 'IA (Claude)' : 'mots-clés'}. Les numéros '
              'écrits en commentaire sont masqués et jamais gardés.',
              style: theme.textTheme.muted.copyWith(fontSize: 13),
            ),
            if (live.sourceMessage != null && !live.finished) ...[
              const SizedBox(height: 8),
              Text(
                live.sourceMessage!,
                style: live.sourceState == 'error'
                    ? theme.textTheme.p.copyWith(
                        color: theme.colorScheme.destructive,
                      )
                    : theme.textTheme.muted,
              ),
            ],
            if (live.cancelReason != null) ...[
              const SizedBox(height: 8),
              Text(
                live.cancelReason!,
                style: theme.textTheme.p.copyWith(
                  color: theme.colorScheme.destructive,
                ),
              ),
            ],
            if (_error != null) _errorBox(_error!),
            const SizedBox(height: 16),
            if (live.status == 'SCHEDULED' || detached)
              ShadButton(
                width: double.infinity,
                enabled: !_busy,
                onPressed: () =>
                    _act(() => widget.api.startLive(widget.liveId)),
                leading: const Icon(LucideIcons.radio, size: 18),
                child: Text(
                  detached ? 'Reprendre la lecture' : 'Commencer le live',
                ),
              ),
            if (live.running && !detached)
              ShadButton.outline(
                width: double.infinity,
                enabled: !_busy,
                onPressed: _stop,
                child: const Text('Terminer le live'),
              ),
            const SizedBox(height: 16),
            Row(
              spacing: 8,
              children: [
                stat('Commentaires', '${board.comments}'),
                stat('Intéressés', '${board.interested}'),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              spacing: 8,
              children: [
                stat('Payés', '${board.paid}'),
                stat('Ventes prévues', formatFcfa(board.forecast)),
              ],
            ),
            const SizedBox(height: 24),
            Text(
              live.finished ? 'Bilan des acheteurs' : 'Acheteurs',
              style: theme.textTheme.h4,
            ),
            const SizedBox(height: 4),
            Text(
              'Chaque acheteur reçoit un code à envoyer sur WhatsApp pour '
              'donner son numéro et payer.',
              style: theme.textTheme.muted.copyWith(fontSize: 13),
            ),
            const SizedBox(height: 12),
            if (board.leads.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Text(
                  live.running
                      ? 'En attente des premiers acheteurs…'
                      : 'Aucun acheteur.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.muted,
                ),
              ),
            for (final lead in board.leads)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _LeadCard(
                  lead: lead,
                  onStatus: _busy ? null : () => _changeStatus(lead),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _LeadCard extends StatelessWidget {
  const _LeadCard({required this.lead, required this.onStatus});
  final LiveLead lead;
  final VoidCallback? onStatus;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return ShadCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 6,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${lead.nickname}  @${lead.tiktokUser}',
                  style: theme.textTheme.p.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Pill(
                leadStatusLabels[lead.status] ?? lead.status,
                tone: _leadTone(lead.status),
              ),
            ],
          ),
          Text(
            'Code ${lead.code} · ${intentLabels[lead.intent] ?? lead.intent}'
            '${lead.phoneSeen ? ' · numéro écrit (masqué)' : ''}',
            style: theme.textTheme.muted,
          ),
          if (lead.items.isEmpty)
            Text('Pas encore de panier.', style: theme.textTheme.muted)
          else ...[
            for (final i in lead.items)
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${i.quantity} × ${i.name}'
                      '${i.variant != null ? ' (${i.variant})' : ''}',
                    ),
                  ),
                  Text(
                    i.unitPrice != null
                        ? formatFcfa(i.unitPrice! * i.quantity)
                        : 'prix ?',
                  ),
                ],
              ),
            if (lead.total != null)
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Total',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(
                    formatFcfa(lead.total!),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
          ],
          Row(
            spacing: 8,
            children: [
              if (lead.reply case final reply?)
                ShadButton.outline(
                  size: ShadButtonSize.sm,
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: reply));
                    if (context.mounted) {
                      showVzToast(context, 'Réponse copiée');
                    }
                  },
                  child: const Text('Copier la réponse'),
                ),
              ShadButton.secondary(
                size: ShadButtonSize.sm,
                enabled: onStatus != null,
                onPressed: onStatus,
                child: const Text('Changer le statut'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
