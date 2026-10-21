import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../live_models.dart';
import '../ui/widgets.dart';
import '../wallet_models.dart';

// How often the live screen reads the live again while it runs.
const livePollEvery = Duration(seconds: 3);

PillTone liveTone(String status) => switch (status) {
  'PENDING_PAYMENT' || 'PENDING_REVIEW' => PillTone.pending,
  'ACTIVE' => PillTone.paid,
  'REJECTED' || 'CANCELLED' => PillTone.refused,
  _ => PillTone.neutral,
};

PillTone sessionTone(String status) => switch (status) {
  'INVITED' || 'ACCEPTED' => PillTone.pending,
  'RUNNING' => PillTone.paid,
  'WITHDRAWN' || 'MISSED' || 'CANCELLED' => PillTone.refused,
  _ => PillTone.neutral,
};

PillTone _leadTone(String status) => switch (status) {
  'PAID' || 'DELIVERED' => PillTone.paid,
  'CANCELLED' => PillTone.refused,
  _ => PillTone.pending,
};

String liveDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)} à ${two(d.hour)}h${two(d.minute)}';
}

Widget liveErrorBox(String message) => Padding(
  padding: const EdgeInsets.all(16),
  child: ShadAlert.destructive(
    icon: const Icon(LucideIcons.circleAlert),
    title: Text(message),
  ),
);

String liveMessage(Object e) => switch (e) {
  ApiException(code: 'MODULE_OFF') =>
    'La vente en live n’est pas disponible pour le moment.',
  ApiException(:final message) => message,
  _ => 'Serveur injoignable',
};

/// The seller's live offers. The catalogue, new offers and invitations are
/// on the web.
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
      if (mounted) setState(() => _error = liveMessage(e));
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
          ? (_error == null ? const SkeletonList() : liveErrorBox(_error!))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  Text(
                    'Annonce tes lives et invite des créateurs sur viewzo.app. '
                    'Ici, tu suis les créateurs et tes acheteurs.',
                    style: theme.textTheme.muted,
                  ),
                  const SizedBox(height: 16),
                  if (lives.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 48),
                      child: Text(
                        'Aucune offre pour l’instant.',
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
                                      tone: liveTone(live.status),
                                    ),
                                  ],
                                ),
                                Text(
                                  '${_who(live)}'
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

/// Who sells an offer, and when.
String _who(LiveSale live) {
  if (live.self) {
    final own = live.sessions.firstOrNull;
    return 'Ton live @${own?.tiktokUsername ?? '?'} · ${liveDate(live.startsAt)}';
  }
  const taken = {'INVITED', 'ACCEPTED', 'RUNNING', 'ENDED'};
  final n = live.sessions.where((s) => taken.contains(s.status)).length;
  return '$n/${live.slots} créateur${live.slots > 1 ? 's' : ''} · '
      'jusqu’au ${live.endsAt != null ? liveDate(live.endsAt!) : '?'}';
}

/// One offer: pay it, follow the creators' lives or start your own, and
/// follow the buyers.
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
      _poll(board.sessions.any((s) => s.running));
    } catch (e) {
      if (mounted) setState(() => _error = liveMessage(e));
    }
  }

  void _poll(bool on) {
    if (on && _timer == null) {
      _timer = Timer.periodic(livePollEvery, (_) => _load());
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
      if (mounted) setState(() => _error = liveMessage(e));
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
        body: _error == null ? const SkeletonList() : liveErrorBox(_error!),
      );
    }
    final theme = ShadTheme.of(context);
    final live = board.live;
    final own = live.self ? board.sessions.firstOrNull : null;
    final running = board.sessions.any((s) => s.running);
    // Running, but nothing reads it any more (server restart, TikTok cut).
    final detached = own != null && own.running && own.reading != true;
    final handles = {for (final s in board.sessions) s.id: s.tiktokUsername};
    final muted = theme.textTheme.muted.copyWith(fontSize: 13);
    final danger = theme.textTheme.p.copyWith(
      color: theme.colorScheme.destructive,
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
                  tone: liveTone(live.status),
                ),
                Expanded(
                  child: Text(
                    live.self
                        ? 'Ton live · ${liveDate(live.startsAt)}'
                        : '${liveDate(live.startsAt)} → '
                              '${live.endsAt != null ? liveDate(live.endsAt!) : '?'}',
                    style: theme.textTheme.muted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Les acheteurs t’écrivent sur WhatsApp${live.whatsapp != null ? ' au ${live.whatsapp}' : ''} '
              'avec leur code. Lecture : ${board.ai ? 'IA (Claude)' : 'mots-clés'}. '
              'Les numéros écrits en commentaire sont masqués et jamais gardés.',
              style: muted,
            ),
            if (live.statusReason != null) ...[
              const SizedBox(height: 8),
              Text(live.statusReason!, style: danger),
            ],
            if (_error != null) liveErrorBox(_error!),
            const SizedBox(height: 16),
            if (!live.self) ...[
              if (live.status == 'PENDING_PAYMENT') ...[
                Text(
                  'Mets ${formatFcfa(live.budget)} en séquestre pour envoyer '
                  'l’offre à l’équipe. Ce qui n’est pas dépensé revient sur ton solde.',
                  style: muted,
                ),
                const SizedBox(height: 8),
                ShadButton(
                  width: double.infinity,
                  enabled: !_busy,
                  onPressed: () => _act(() => widget.api.payLive(live.id)),
                  child: const Text('Payer depuis mon solde'),
                ),
              ] else
                Text(
                  '${live.status == 'PENDING_REVIEW' ? 'L’équipe vérifie ton offre. ' : ''}'
                  'Budget ${formatFcfa(live.budget)} · ${formatFcfa(live.spent)} payés'
                  '${live.refunded > 0 ? ' · ${formatFcfa(live.refunded)} remboursés' : ''}',
                  style: muted,
                ),
              const SizedBox(height: 16),
              Text('Créateurs', style: theme.textTheme.h4),
              const SizedBox(height: 8),
              if (board.sessions.isEmpty)
                Text('Aucun créateur pour l’instant.', style: muted),
              for (final s in board.sessions)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ShadCard(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      spacing: 4,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '@${s.tiktokUsername}'
                                '${s.creatorName != null ? ' · ${s.creatorName}' : ''}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            Pill(
                              sessionStatusLabels[s.status] ?? s.status,
                              tone: sessionTone(s.status),
                            ),
                          ],
                        ),
                        Text(
                          [
                            if (s.scheduledAt != null)
                              'prévu ${liveDate(s.scheduledAt!)}',
                            if (s.running && s.viewers != null)
                              '${s.viewers} spectateurs',
                            if (s.status == 'ENDED')
                              '${s.peakViewers} spectateurs au plus fort · '
                                  '${payoutLabels[s.payout]}'
                                  '${s.cost > 0 ? ' · ${formatFcfa(s.cost)}' : ''}',
                          ].join(' · '),
                          style: muted,
                        ),
                      ],
                    ),
                  ),
                ),
            ],
            if (own != null) ...[
              Text(
                '@${own.tiktokUsername}'
                '${own.viewers != null && own.running ? ' · ${own.viewers} spectateurs' : ''}',
                style: theme.textTheme.muted,
              ),
              if (live.serviceFee case final fee?
                  when fee > 0 && own.status == 'ACCEPTED')
                Text(
                  'La lecture des commentaires coûte ${formatFcfa(fee)}, pris '
                  'sur ton solde quand tu commences.',
                  style: muted,
                ),
              if (own.sourceMessage != null && own.status != 'ENDED') ...[
                const SizedBox(height: 8),
                Text(
                  own.sourceMessage!,
                  style: own.sourceState == 'error' ? danger : muted,
                ),
              ],
              const SizedBox(height: 12),
              if (own.status == 'ACCEPTED' || detached)
                ShadButton(
                  width: double.infinity,
                  enabled: !_busy,
                  onPressed: () => _act(() => widget.api.startLive(live.id)),
                  leading: const Icon(LucideIcons.radio, size: 18),
                  child: Text(
                    detached ? 'Reprendre la lecture' : 'Commencer le live',
                  ),
                ),
              if (own.running && !detached)
                ShadButton.outline(
                  width: double.infinity,
                  enabled: !_busy,
                  onPressed: _stop,
                  child: const Text('Terminer le live'),
                ),
            ],
            const SizedBox(height: 16),
            LiveStatsGrid(stats: board.stats),
            const SizedBox(height: 24),
            Text(
              live.closed ? 'Bilan des acheteurs' : 'Acheteurs',
              style: theme.textTheme.h4,
            ),
            const SizedBox(height: 4),
            Text(
              'Chaque acheteur reçoit un code et t’écrit sur WhatsApp. C’est '
              'toi qui livres et encaisses.',
              style: muted,
            ),
            const SizedBox(height: 12),
            if (board.leads.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Text(
                  running
                      ? 'En attente des premiers acheteurs…'
                      : 'Aucun acheteur.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.muted,
                ),
              ),
            for (final lead in board.leads)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: LeadCard(
                  lead: lead,
                  via: live.self ? null : handles[lead.sessionId],
                  onStatus: _busy ? null : () => _changeStatus(lead),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Comments, buyers, payments and expected sales of a live.
class LiveStatsGrid extends StatelessWidget {
  const LiveStatsGrid({super.key, required this.stats});
  final LiveStats stats;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
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
    return Column(
      spacing: 8,
      children: [
        Row(
          spacing: 8,
          children: [
            stat('Commentaires', '${stats.comments}'),
            stat('Intéressés', '${stats.interested}'),
          ],
        ),
        Row(
          spacing: 8,
          children: [
            stat('Payés', '${stats.paid}'),
            stat('Ventes prévues', formatFcfa(stats.forecast)),
          ],
        ),
      ],
    );
  }
}

/// A buyer and their cart. Without [onStatus] the card is read-only, as on
/// the creator's screen.
class LeadCard extends StatelessWidget {
  const LeadCard({super.key, required this.lead, this.via, this.onStatus});
  final LiveLead lead;

  /// TikTok account of the live the buyer came from.
  final String? via;
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
            '${via != null ? ' · live de @$via' : ''}'
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
              if (onStatus != null)
                ShadButton.secondary(
                  size: ShadButtonSize.sm,
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
