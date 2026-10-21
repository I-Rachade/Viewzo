import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../live_models.dart';
import '../ui/widgets.dart';
import '../wallet_models.dart';
import 'live_screen.dart';

/// Lets the creator pick the hour of their live inside an offer's period.
Future<DateTime?> pickLiveHour(BuildContext context, LiveOffer offer) {
  final now = DateTime.now();
  final first = offer.startsAt.isAfter(now) ? offer.startsAt : now;
  final last = offer.endsAt ?? first.add(const Duration(days: 7));
  final days = <DateTime>[
    for (
      var d = DateTime(first.year, first.month, first.day);
      !d.isAfter(last) && d.difference(first).inDays < 60;
      d = DateTime(d.year, d.month, d.day + 1)
    )
      d,
  ];
  return showModalBottomSheet<DateTime>(
    context: context,
    isScrollControlled: true,
    builder: (context) => _HourPicker(days: days, first: first, last: last),
  );
}

class _HourPicker extends StatefulWidget {
  const _HourPicker({
    required this.days,
    required this.first,
    required this.last,
  });
  final List<DateTime> days;
  final DateTime first;
  final DateTime last;

  @override
  State<_HourPicker> createState() => _HourPickerState();
}

class _HourPickerState extends State<_HourPicker> {
  late DateTime _day = widget.days.first;
  DateTime? _at;

  List<DateTime> get _hours => [
    for (var h = 0; h < 24; h++) DateTime(_day.year, _day.month, _day.day, h),
  ].where((t) => t.isAfter(widget.first) && t.isBefore(widget.last)).toList();

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    const weekdays = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 12,
          children: [
            Text('Heure de ton live', style: theme.textTheme.h4),
            SizedBox(
              height: 40,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final d in widget.days)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(
                          '${weekdays[d.weekday - 1]} ${d.day}/${d.month}',
                        ),
                        selected: d == _day,
                        onSelected: (_) => setState(() {
                          _day = d;
                          _at = null;
                        }),
                      ),
                    ),
                ],
              ),
            ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final t in _hours)
                  ChoiceChip(
                    label: Text('${t.hour}h'),
                    selected: t == _at,
                    onSelected: (_) => setState(() => _at = t),
                  ),
              ],
            ),
            if (_hours.isEmpty)
              Text(
                'Plus d’heure libre ce jour-là.',
                style: theme.textTheme.muted,
              ),
            ShadButton(
              width: double.infinity,
              enabled: _at != null,
              onPressed: () => Navigator.of(context).pop(_at),
              child: const Text('Valider'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Creators' lives: offers to accept, invitations, their lives and pay.
class CreatorLivesScreen extends StatefulWidget {
  const CreatorLivesScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<CreatorLivesScreen> createState() => _CreatorLivesScreenState();
}

class _CreatorLivesScreenState extends State<CreatorLivesScreen> {
  CreatorLiveHome? _home;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final home = await widget.api.creatorLives();
      if (mounted) {
        setState(() {
          _home = home;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = liveMessage(e));
    }
  }

  Future<void> _act(Future<void> Function() action, [String? done]) async {
    setState(() => _busy = true);
    try {
      await action();
      await _load();
      if (done != null && mounted) showVzToast(context, done);
    } catch (e) {
      if (mounted) setState(() => _error = liveMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String title, String body, String ok) async =>
      await showShadDialog<bool>(
        context: context,
        builder: (context) => ShadDialog.alert(
          title: Text(title),
          description: Text(body),
          actions: [
            ShadButton.outline(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Annuler'),
            ),
            ShadButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(ok),
            ),
          ],
        ),
      ) ==
      true;

  Future<void> _accept(LiveOffer offer, {String? invitation}) async {
    final at = await pickLiveHour(context, offer);
    if (at == null) return;
    await _act(
      () => invitation != null
          ? widget.api.answerLiveInvite(invitation, at)
          : widget.api.acceptLive(offer.id, at),
      'Live accepté pour le ${liveDate(at)}',
    );
  }

  Future<void> _open(String sessionId) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            CreatorLiveScreen(api: widget.api, sessionId: sessionId),
      ),
    );
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final home = _home;
    final theme = ShadTheme.of(context);
    if (home == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Lives de vente')),
        body: _error == null ? const SkeletonList() : liveErrorBox(_error!),
      );
    }
    final muted = theme.textTheme.muted.copyWith(fontSize: 13);
    final invitations = home.sessions.where((s) => s.status == 'INVITED');
    final planned = home.sessions.where(
      (s) => s.status == 'ACCEPTED' || s.status == 'RUNNING',
    );
    final past = home.sessions.where(
      (s) => !{'INVITED', 'ACCEPTED', 'RUNNING'}.contains(s.status),
    );

    Widget section(String title) => Padding(
      padding: const EdgeInsets.only(top: 24, bottom: 8),
      child: Text(title, style: theme.textTheme.h4),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Lives de vente')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(
              'Vends les produits d’une boutique pendant ton live TikTok. Tu es '
              'payé selon le nombre de spectateurs au plus fort (à partir de '
              '${home.minMinutes} minutes de live). Les acheteurs écrivent à '
              'la boutique sur WhatsApp : tu n’as rien à livrer.',
              style: muted,
            ),
            const SizedBox(height: 8),
            Text(
              'Te retirer d’un live accepté bloque les lives pendant '
              '${home.blockDays} jours ; après ${home.banAfter} retraits de '
              'suite, tu ne peux plus en faire. Un live pas fait compte comme '
              'un retrait.',
              style: muted,
            ),
            if (home.tiktok case final t?) ...[
              const SizedBox(height: 8),
              Text('Ton compte : @${t.username} · ${t.followers} abonnés'),
            ],
            if (!home.eligible && home.reason != null) ...[
              const SizedBox(height: 12),
              ShadAlert(
                icon: const Icon(LucideIcons.info),
                title: Text(home.reason!),
              ),
            ],
            if (_error != null) liveErrorBox(_error!),
            if (invitations.isNotEmpty) section('Invitations'),
            for (final s in invitations)
              _OfferCard(
                offer: s.offer,
                busy: _busy,
                canAccept: home.eligible,
                acceptLabel: 'Accepter',
                onAccept: () => _accept(s.offer, invitation: s.id),
                onDecline: () async {
                  if (await _confirm(
                    'Refuser l’invitation ?',
                    'Cela ne compte pas comme un retrait.',
                    'Refuser',
                  )) {
                    await _act(() => widget.api.answerLiveInvite(s.id, null));
                  }
                },
              ),
            if (planned.isNotEmpty) section('Mes lives prévus'),
            for (final s in planned)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: ShadCard(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 8,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              s.offer.title,
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
                      if (s.scheduledAt != null)
                        Text(
                          'Prévu le ${liveDate(s.scheduledAt!)}',
                          style: muted,
                        ),
                      ShadButton(
                        width: double.infinity,
                        onPressed: () => _open(s.id),
                        leading: const Icon(LucideIcons.radio, size: 18),
                        child: Text(
                          s.status == 'RUNNING'
                              ? 'Suivre mon live'
                              : 'Ouvrir pour commencer',
                        ),
                      ),
                      if (s.status == 'ACCEPTED')
                        Row(
                          spacing: 8,
                          children: [
                            ShadButton.outline(
                              size: ShadButtonSize.sm,
                              enabled: !_busy,
                              onPressed: () async {
                                final at = await pickLiveHour(context, s.offer);
                                if (at != null) {
                                  await _act(
                                    () => widget.api.rescheduleLive(s.id, at),
                                    'Heure changée',
                                  );
                                }
                              },
                              child: const Text('Changer l’heure'),
                            ),
                            ShadButton.outline(
                              size: ShadButtonSize.sm,
                              enabled: !_busy,
                              onPressed: () async {
                                if (await _confirm(
                                  'Te retirer de ce live ?',
                                  'Tu ne pourras plus accepter de live pendant '
                                      '${home.blockDays} jours.',
                                  'Me retirer',
                                )) {
                                  await _act(
                                    () => widget.api.withdrawLive(s.id),
                                  );
                                }
                              },
                              child: const Text('Me retirer'),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            section('Offres ouvertes'),
            if (home.offers.isEmpty)
              Text(
                home.eligible
                    ? 'Aucune offre pour l’instant. Tu reçois une notification '
                          'dès qu’une offre s’ouvre.'
                    : 'Les offres s’affichent ici dès que ton profil remplit '
                          'les conditions.',
                style: muted,
              ),
            for (final o in home.offers)
              _OfferCard(
                offer: o,
                busy: _busy,
                canAccept: home.eligible,
                acceptLabel: 'Accepter',
                onAccept: () => _accept(o),
              ),
            if (past.isNotEmpty) section('Historique'),
            for (final s in past)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(s.offer.title),
                subtitle: Text(
                  [
                    sessionStatusLabels[s.status] ?? s.status,
                    if (s.status == 'ENDED') ...[
                      '${s.peakViewers} spectateurs',
                      payoutLabels[s.payout] ?? s.payout,
                    ],
                    ?s.payoutReason,
                  ].join(' · '),
                ),
                trailing: s.earned > 0 ? Text(formatFcfa(s.earned)) : null,
                onTap: s.startedAt != null ? () => _open(s.id) : null,
              ),
          ],
        ),
      ),
    );
  }
}

class _OfferCard extends StatelessWidget {
  const _OfferCard({
    required this.offer,
    required this.busy,
    required this.canAccept,
    required this.acceptLabel,
    required this.onAccept,
    this.onDecline,
  });
  final LiveOffer offer;
  final bool busy;
  final bool canAccept;
  final String acceptLabel;
  final VoidCallback onAccept;
  final VoidCallback? onDecline;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final muted = theme.textTheme.muted.copyWith(fontSize: 13);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
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
                    offer.title,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                if (offer.placesLeft case final n?)
                  Pill('$n place${n > 1 ? 's' : ''}', tone: PillTone.pending),
              ],
            ),
            Text(
              '${offer.shop != null ? '${offer.shop} · ' : ''}'
              '${liveDate(offer.startsAt)} → '
              '${offer.endsAt != null ? liveDate(offer.endsAt!) : '?'}'
              '${offer.demo ? ' · démo' : ''}',
              style: muted,
            ),
            Text(
              offer.demo
                  ? 'Live de démonstration : pas de paiement.'
                  : '${formatFcfa(offer.ratePer100)} par 100 spectateurs au '
                        'plus fort, jusqu’à ${formatFcfa(offer.maxEarning)}',
            ),
            if (offer.products.isNotEmpty)
              Text(
                offer.products
                    .take(6)
                    .map((p) => '${p.name} (${formatFcfa(p.price)})')
                    .join(' · '),
                style: muted,
              ),
            if (canAccept)
              Row(
                spacing: 8,
                children: [
                  ShadButton(
                    enabled: !busy,
                    onPressed: onAccept,
                    child: Text(acceptLabel),
                  ),
                  if (onDecline != null)
                    ShadButton.outline(
                      enabled: !busy,
                      onPressed: onDecline,
                      child: const Text('Refuser'),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

/// A creator's own live: start it, read out the answers, end it.
class CreatorLiveScreen extends StatefulWidget {
  const CreatorLiveScreen({
    super.key,
    required this.api,
    required this.sessionId,
  });
  final ApiClient api;
  final String sessionId;

  @override
  State<CreatorLiveScreen> createState() => _CreatorLiveScreenState();
}

class _CreatorLiveScreenState extends State<CreatorLiveScreen> {
  CreatorLiveBoard? _board;
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
      final board = await widget.api.creatorLiveBoard(widget.sessionId);
      if (!mounted) return;
      setState(() {
        _board = board;
        _error = null;
      });
      final on = board.session.running;
      if (on && _timer == null) {
        _timer = Timer.periodic(livePollEvery, (_) => _load());
      } else if (!on) {
        _timer?.cancel();
        _timer = null;
      }
    } catch (e) {
      if (mounted) setState(() => _error = liveMessage(e));
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
        title: const Text('Terminer ton live ?'),
        description: const Text('Ton gain est calculé maintenant.'),
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
    if (ok == true) {
      await _act(() => widget.api.stopCreatorLive(widget.sessionId));
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
    final muted = theme.textTheme.muted.copyWith(fontSize: 13);
    final s = board.session;
    final detached = s.running && !board.reading;
    final opensAt = board.startsAt.subtract(const Duration(minutes: 30));
    final early = DateTime.now().isBefore(opensAt);

    return Scaffold(
      appBar: AppBar(title: Text(board.title)),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Row(
              spacing: 8,
              children: [
                Pill(
                  sessionStatusLabels[s.status] ?? s.status,
                  tone: sessionTone(s.status),
                ),
                Expanded(
                  child: Text(
                    '@${s.tiktokUsername}'
                    '${board.shop != null ? ' · pour ${board.shop}' : ''}'
                    '${s.running && s.viewers != null ? ' · ${s.viewers} spectateurs' : ''}',
                    style: theme.textTheme.muted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Lance ton live sur TikTok, puis appuie sur « Commencer ». Viewzo '
              'lit les commentaires et te propose la réponse à donner à chaque '
              'acheteur, avec le code à envoyer à la boutique sur WhatsApp.',
              style: muted,
            ),
            if (s.sourceMessage != null && s.status != 'ENDED') ...[
              const SizedBox(height: 8),
              Text(
                s.sourceMessage!,
                style: s.sourceState == 'error'
                    ? theme.textTheme.p.copyWith(
                        color: theme.colorScheme.destructive,
                      )
                    : muted,
              ),
            ],
            if (s.status == 'ENDED') ...[
              const SizedBox(height: 8),
              Text(
                '${s.peakViewers} spectateurs au plus fort · '
                '${payoutLabels[s.payout]}'
                '${s.earned > 0 ? ' · ${formatFcfa(s.earned)}' : ''}'
                '${s.payoutReason != null ? ' · ${s.payoutReason}' : ''}',
              ),
            ],
            if (_error != null) liveErrorBox(_error!),
            const SizedBox(height: 16),
            if (s.status == 'ACCEPTED')
              early
                  ? Text(
                      'Tu pourras commencer à partir du ${liveDate(opensAt)}.',
                      style: muted,
                    )
                  : ShadButton(
                      width: double.infinity,
                      enabled: !_busy,
                      onPressed: () => _act(
                        () => widget.api.startCreatorLive(widget.sessionId),
                      ),
                      leading: const Icon(LucideIcons.radio, size: 18),
                      child: const Text('Commencer'),
                    ),
            if (detached)
              ShadButton(
                width: double.infinity,
                enabled: !_busy,
                onPressed: () =>
                    _act(() => widget.api.startCreatorLive(widget.sessionId)),
                child: const Text('Reprendre la lecture'),
              ),
            if (s.running && !detached)
              ShadButton.outline(
                width: double.infinity,
                enabled: !_busy,
                onPressed: _stop,
                child: const Text('Terminer le live'),
              ),
            const SizedBox(height: 16),
            LiveStatsGrid(stats: board.stats),
            const SizedBox(height: 24),
            Text('Acheteurs', style: theme.textTheme.h4),
            const SizedBox(height: 12),
            if (board.leads.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Text(
                  s.running
                      ? 'En attente des premiers acheteurs…'
                      : 'Aucun acheteur.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.muted,
                ),
              ),
            for (final lead in board.leads)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: LeadCard(lead: lead),
              ),
          ],
        ),
      ),
    );
  }
}
