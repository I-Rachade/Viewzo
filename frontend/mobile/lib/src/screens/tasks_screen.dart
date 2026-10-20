import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../creator_models.dart';
import '../task_models.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Tasks the creator can take, and the ones they accepted with the link to
/// submit once posted.
class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key, required this.api, this.pickImage});
  final ApiClient api;

  /// Picks a screenshot from the phone; replaced in tests.
  final Future<XFile?> Function()? pickImage;

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  List<CampaignTask>? _available;
  List<Assignment>? _assignments;
  CreatorResults? _results;
  SocialNetwork? _network;
  String? _error;
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => _run(() async {
    final results = await Future.wait([
      widget.api.availableTasks(),
      widget.api.assignments(),
    ]);
    setState(() {
      _available = results[0] as List<CampaignTask>;
      _assignments = results[1] as List<Assignment>;
    });
    _loadResults();
  });

  Future<void> _loadResults() async {
    try {
      final results = await widget.api.results();
      if (mounted) setState(() => _results = results);
    } catch (_) {
      // The summary simply stays hidden.
    }
  }

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

  Future<void> _accept(CampaignTask task) => _run(() async {
    await widget.api.acceptTask(task.id);
    await _load();
    if (mounted) {
      showVzToast(context, 'Tâche acceptée, retrouve-la dans Mes tâches');
    }
  });

  /// Null when the creator closes the dialog without sending.
  Future<bool?> _submit(Assignment assignment, VoidCallback sending) async {
    final url = await showShadDialog<String>(
      context: context,
      builder: (_) => _SubmitDialog(initial: assignment.postUrl),
    );
    if (url == null) return null;
    sending();
    await _run(() async {
      await widget.api.submitPost(assignment.id, url);
      await _load();
    });
    if (_error != null) return false;
    if (mounted) {
      showVzToast(context, 'Lien envoyé, l’équipe vérifie tes vues');
    }
    return true;
  }

  /// Picks a screenshot, asks the views it shows and sends it.
  Future<void> _sendScreenshot(Assignment assignment) async {
    final pick =
        widget.pickImage ??
        () => ImagePicker().pickImage(
          source: ImageSource.gallery,
          maxWidth: 2000,
          imageQuality: 85,
        );
    final file = await pick();
    if (file == null || !mounted) return;
    final views = await showShadDialog<int>(
      context: context,
      builder: (_) => const _ViewsDialog(),
    );
    if (views == null) return;
    final bytes = await file.readAsBytes();
    DateTime? capturedAt;
    try {
      capturedAt = await file.lastModified();
    } catch (_) {
      // Some pickers don't know it; the team then sees "date inconnue".
    }
    await _run(() async {
      await widget.api.addScreenshot(
        assignment.id,
        bytes: bytes,
        filename: file.name.isEmpty ? 'capture.jpg' : file.name,
        declaredViews: views,
        capturedAt: capturedAt,
      );
      await _load();
    });
    if (_error == null && mounted) {
      showVzToast(context, 'Capture envoyée, l’équipe la vérifie');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tâches')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: _TabSwitch(
              value: _tab,
              onChanged: (tab) => setState(() => _tab = tab),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: ShadAlert.destructive(
                icon: const Icon(LucideIcons.circleAlert),
                title: Text(_error!),
              ),
            ),
          Expanded(
            child: IndexedStack(
              index: _tab,
              children: [_availableList(), _assignmentList()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _availableList() {
    final tasks = _available;
    if (tasks == null) return const SkeletonList();
    final networks = {for (final t in tasks) t.network}.toList();
    final shown = _network == null
        ? tasks
        : tasks.where((t) => t.network == _network).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (tasks.isEmpty)
            _Empty(
              icon: LucideIcons.megaphone,
              text:
                  'Aucune tâche pour toi en ce moment. Vérifie que tes comptes '
                  'sont éligibles et que tes compétences sont à jour.',
            ),
          if (networks.length > 1)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              // One row that scrolls sideways, into the list's margins.
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                clipBehavior: Clip.none,
                child: Row(
                  spacing: 8,
                  children: [
                    _Filter(
                      label: 'Tous',
                      selected: _network == null,
                      onTap: () => setState(() => _network = null),
                    ),
                    for (final n in networks)
                      _Filter(
                        label: n.label,
                        selected: _network == n,
                        onTap: () => setState(() => _network = n),
                      ),
                  ],
                ),
              ),
            ),
          for (final (i, task) in shown.indexed)
            FadeSlideIn(
              key: ValueKey(task.id),
              index: i,
              child: task.locked
                  ? _TaskCard(
                      task: task,
                      status: ('Bloquée', PillTone.neutral),
                      details: _LockedHint(task.network),
                      action: null,
                    )
                  : _TaskCard(
                      task: task,
                      action: _MorphButton(
                        label: 'Accepter',
                        color: VzColors.coral,
                        onPress: (loading) async {
                          loading();
                          await _accept(task);
                          return _error == null;
                        },
                      ),
                    ),
            ),
        ],
      ),
    );
  }

  Widget _assignmentList() {
    final assignments = _assignments;
    if (assignments == null) return const SkeletonList();
    final results = _results;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (results != null && assignments.isNotEmpty)
            FadeSlideIn(child: _ResultsCard(results: results)),
          if (assignments.isEmpty)
            const _Empty(
              icon: LucideIcons.clipboardList,
              text: 'Tu n’as pas encore accepté de tâche.',
            ),
          for (final (i, a) in assignments.indexed)
            FadeSlideIn(
              index: i + 1,
              child: _TaskCard(
                task: a.task,
                status: _status(a),
                details: _AssignmentDetails(assignment: a),
                action: _actions(a),
              ),
            ),
        ],
      ),
    );
  }

  (String, PillTone) _status(Assignment a) {
    final statut = a.task.network == SocialNetwork.whatsappStatus;
    if (!a.submitted && !(statut && a.screenshots > 0)) {
      return ('À publier', PillTone.violet);
    }
    return (
      a.reviewStatus.label,
      switch (a.reviewStatus) {
        ReviewStatus.validated => PillTone.paid,
        ReviewStatus.rejected => PillTone.refused,
        _ => PillTone.pending,
      },
    );
  }

  Widget? _actions(Assignment a) {
    if (a.reviewStatus == ReviewStatus.rejected) return null;
    final statut = a.task.network == SocialNetwork.whatsappStatus;
    final screenshot = ShadButton.secondary(
      leading: const Icon(LucideIcons.imagePlus, size: 18),
      onPressed: () => _sendScreenshot(a),
      child: Flexible(
        child: Text(
          statut ? 'Envoyer une capture' : 'Ajouter une capture',
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
    if (statut) return screenshot;
    if (!a.submitted) {
      return _MorphButton(
        label: 'J’ai publié',
        color: ShadTheme.of(context).colorScheme.primary,
        foreground: ShadTheme.of(context).colorScheme.primaryForeground,
        onPress: (loading) => _submit(a, loading),
      );
    }
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      alignment: WrapAlignment.end,
      children: [
        if (a.reviewStatus != ReviewStatus.validated)
          ShadButton.outline(
            onPressed: () => _submit(a, () {}),
            child: const Text('Modifier le lien'),
          ),
        screenshot,
      ],
    );
  }
}

String _views(int n) {
  final digits = '$n';
  final out = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write('\u202F');
    out.write(digits[i]);
  }
  return out.toString();
}

/// "s" for a French plural: 0 and 1 stay singular.
String _s(int n) => n > 1 ? 's' : '';

String _time(DateTime d) =>
    '${_date(d)} à ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

/// "Disponibles | Mes tâches": a segmented control in the iOS manner.
class _TabSwitch extends StatelessWidget {
  const _TabSwitch({required this.value, required this.onChanged});
  final int value;
  final ValueChanged<int> onChanged;

  static const _labels = ['Disponibles', 'Mes tâches'];

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
          for (final (i, label) in _labels.indexed)
            Expanded(
              child: Semantics(
                button: true,
                selected: i == value,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onChanged(i),
                  child: AnimatedContainer(
                    duration: VzMotion.of(context, VzMotion.standard),
                    curve: VzMotion.easeOut,
                    height: 36,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: i == value ? colors.card : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                      boxShadow: i == value
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
                      label,
                      style: theme.textTheme.small.copyWith(
                        fontWeight: FontWeight.w700,
                        color: i == value
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

/// A calm message for an empty list.
class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 32),
      child: Column(
        spacing: 12,
        children: [
          Icon(icon, size: 28, color: theme.colorScheme.mutedForeground),
          Text(text, textAlign: TextAlign.center, style: theme.textTheme.muted),
        ],
      ),
    );
  }
}

/// Totals of what the team validated and paid, on top of "Mes tâches".
class _ResultsCard extends StatelessWidget {
  const _ResultsCard({required this.results});
  final CreatorResults results;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    Widget stat(String label, String value) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 2,
        children: [
          Text(label, style: theme.textTheme.muted.copyWith(fontSize: 13)),
          Text(
            value,
            style: theme.textTheme.large.copyWith(
              fontFamily: 'Sora',
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: ShadCard(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 14,
          children: [
            Text('Mes résultats', style: theme.textTheme.h4),
            Row(
              spacing: 12,
              children: [
                stat('Vues validées', _views(results.validViews)),
                stat(
                  'Gagné ce mois',
                  '${_views(results.earnedThisMonth)} FCFA',
                ),
              ],
            ),
            Row(
              spacing: 12,
              children: [
                stat('Gagné au total', '${_views(results.earned)} FCFA'),
                stat(
                  'Taux de validation',
                  results.validationRate == null
                      ? '—'
                      : '${results.validationRate} %',
                ),
              ],
            ),
            const ShadSeparator.horizontal(margin: EdgeInsets.zero),
            Text(
              '${results.toReview} en vérification · ${results.needsFix} à '
              'corriger · ${results.validated} validée${_s(results.validated)} · '
              '${results.rejected} refusée${_s(results.rejected)}',
              style: theme.textTheme.muted.copyWith(fontSize: 13, height: 1.35),
            ),
          ],
        ),
      ),
    );
  }
}

/// The team's decision, the counted views and, for a statut, the
/// screenshots still to send.
class _AssignmentDetails extends StatelessWidget {
  const _AssignmentDetails({required this.assignment});
  final Assignment assignment;

  @override
  Widget build(BuildContext context) {
    final a = assignment;
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 8,
        children: [
          if (a.reviewReason != null)
            Text(
              a.reviewReason!,
              style: theme.textTheme.small.copyWith(
                color: colors.destructive,
                height: 1.35,
              ),
            ),
          if (a.submitted || a.screenshots > 0)
            Text(
              [
                // The figures stay on the line of their words.
                '${_views(a.validViews)}\u00A0vue${_s(a.validViews)}\u00A0'
                    'validée${_s(a.validViews)}',
                '${_views(a.earned)}\u00A0FCFA\u00A0gagnés',
                if (a.declaredViews != null && a.declaredViews != a.validViews)
                  '${_views(a.declaredViews!)} déclarée${_s(a.declaredViews!)}',
              ].join(' · '),
              style: theme.textTheme.small.copyWith(height: 1.35),
            ),
          for (final (i, step) in a.proofSteps.indexed)
            Row(
              spacing: 10,
              children: [
                Container(
                  width: 24,
                  height: 24,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: step.doneAt != null
                        ? VzColors.paid
                        : colors.secondary,
                  ),
                  child: step.doneAt != null
                      ? const Icon(
                          LucideIcons.check,
                          size: 14,
                          color: Colors.white,
                        )
                      : Text(
                          '${i + 1}',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: colors.secondaryForeground,
                          ),
                        ),
                ),
                Expanded(
                  child: Text(
                    '${step.label} · ${switch ((step.doneAt, step.dueAt)) {
                      (final done?, _) => 'envoyée le ${_time(done)}',
                      (null, final due?) => 'à envoyer vers le ${_time(due)}',
                      _ => 'dès que ton statut est publié',
                    }}',
                    style: theme.textTheme.small.copyWith(
                      fontWeight: FontWeight.w400,
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

/// Asks how many views the screenshot shows.
class _ViewsDialog extends StatefulWidget {
  const _ViewsDialog();

  @override
  State<_ViewsDialog> createState() => _ViewsDialogState();
}

class _ViewsDialogState extends State<_ViewsDialog> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final views = int.tryParse(_controller.text.trim());
    if (views == null || views < 0) {
      setState(() => _error = 'Écris le nombre de vues visible sur la capture');
      return;
    }
    Navigator.pop(context, views);
  }

  @override
  Widget build(BuildContext context) => ShadDialog(
    title: const Text('Vues sur la capture'),
    actions: [
      ShadButton.outline(
        onPressed: () => Navigator.pop(context),
        child: const Text('Annuler'),
      ),
      ShadButton(onPressed: _send, child: const Text('Envoyer')),
    ],
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: ShadInputFormField(
        controller: _controller,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        autofocus: true,
        placeholder: const Text('Ex. : 350'),
        trailing: const Text('vues'),
        forceErrorText: _error,
      ),
    ),
  );
}

String _date(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.task,
    required this.action,
    this.status,
    this.details,
  });
  final CampaignTask task;
  final Widget? action;
  final (String, PillTone)? status;
  final Widget? details;

  @override
  Widget build(BuildContext context) {
    final brief = task.brief;
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    final body = theme.textTheme.small.copyWith(
      fontWeight: FontWeight.w400,
      height: 1.4,
    );
    final duration = switch ((brief.minDurationSec, brief.maxDurationSec)) {
      (null, null) => null,
      (final min?, null) => 'au moins $min s',
      (null, final max?) => 'au plus $max s',
      (final min?, final max?) => '$min à $max s',
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: ShadCard(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 8,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 8,
              children: [
                Expanded(
                  child: Text(
                    brief.title,
                    style: theme.textTheme.large.copyWith(
                      fontFamily: 'Sora',
                      height: 1.3,
                    ),
                  ),
                ),
                if (status case (final label, final tone))
                  Pill(label, tone: tone),
              ],
            ),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Pill(task.network.label, tone: PillTone.paid),
                Text(task.contentType.label, style: theme.textTheme.muted),
              ],
            ),
            Text(
              // Breaks only after the dot, never inside "jusqu’au <date>".
              '${task.ratePer1000} FCFA pour 1 000 vues\u00A0· '
              'jusqu’au\u00A0${_date(brief.endsAt)}',
              style: theme.textTheme.p.copyWith(
                fontWeight: FontWeight.w700,
                color: theme.brightness == Brightness.dark
                    ? const Color(0xFF7BE0B0)
                    : VzColors.paidText,
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
              decoration: BoxDecoration(
                color: colors.muted,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Hashtag obligatoire : ${brief.hashtag}',
                      style: body.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  Semantics(
                    label: 'Copier',
                    child: ShadIconButton.ghost(
                      icon: const Icon(LucideIcons.copy, size: 18),
                      width: 36,
                      height: 36,
                      onPressed: () =>
                          Clipboard.setData(ClipboardData(text: brief.hashtag)),
                    ),
                  ),
                ],
              ),
            ),
            if (brief.keyMessage != null)
              Text(
                'Message : ${brief.keyMessage}',
                style: body.copyWith(fontWeight: FontWeight.w600),
              ),
            if (brief.callToAction != null)
              Text('Appel à l’action : ${brief.callToAction}', style: body),
            if (brief.sound != null) Text('Son : ${brief.sound}', style: body),
            if (brief.productDetails != null)
              Text('Produit : ${brief.productDetails}', style: body),
            if (brief.caption != null)
              Row(
                children: [
                  Expanded(
                    child: Text('Légende : ${brief.caption}', style: body),
                  ),
                  Semantics(
                    label: 'Copier la légende',
                    child: ShadIconButton.ghost(
                      icon: const Icon(LucideIcons.copy, size: 18),
                      width: 36,
                      height: 36,
                      onPressed: () => Clipboard.setData(
                        ClipboardData(text: brief.caption!),
                      ),
                    ),
                  ),
                ],
              ),
            Text(
              [
                'Langue : ${brief.language}',
                if (brief.faceRequired) 'visage visible',
                ?duration,
                if (brief.tone != null) 'ton ${brief.tone}',
              ].join(' · '),
              style: body,
            ),
            if (brief.mandatoryElements.isNotEmpty)
              Text(
                'À inclure : ${brief.mandatoryElements.join(', ')}',
                style: body,
              ),
            if (brief.forbiddenElements.isNotEmpty)
              Text(
                'Interdit : ${brief.forbiddenElements.join(', ')}',
                style: body,
              ),
            if (brief.files.isNotEmpty ||
                brief.assetUrls.isNotEmpty ||
                brief.examples.isNotEmpty)
              Wrap(
                spacing: 16,
                children: [
                  for (final f in brief.files)
                    _LinkButton(
                      label: f.purpose == 'BRIEF'
                          ? (f.kind == 'AUDIO' ? 'Brief vocal' : 'Brief vidéo')
                          : f.name,
                      url: f.url,
                    ),
                  for (final (i, url) in brief.assetUrls.indexed)
                    _LinkButton(label: 'Élément ${i + 1}', url: url),
                  for (final (i, url) in brief.examples.indexed)
                    _LinkButton(label: 'Exemple ${i + 1}', url: url),
                ],
              ),
            ?details,
            if (action != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Align(alignment: Alignment.centerRight, child: action),
              ),
          ],
        ),
      ),
    );
  }
}

/// Why a task can't be taken yet: no eligible account on its network.
class _LockedHint extends StatelessWidget {
  const _LockedHint(this.network);
  final SocialNetwork network;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Row(
      spacing: 8,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          LucideIcons.lock,
          size: 16,
          color: theme.colorScheme.mutedForeground,
        ),
        Expanded(
          child: Text(
            'Ajoute un compte ${network.label} vérifié dans Mes comptes '
            'pour accepter cette tâche.',
            style: theme.textTheme.small.copyWith(
              fontWeight: FontWeight.w500,
              height: 1.4,
            ),
          ),
        ),
      ],
    );
  }
}

class _LinkButton extends StatelessWidget {
  const _LinkButton({required this.label, required this.url});
  final String label;
  final String url;

  @override
  Widget build(BuildContext context) => ShadButton.link(
    size: ShadButtonSize.sm,
    padding: EdgeInsets.zero,
    leading: const Icon(LucideIcons.externalLink, size: 16),
    onPressed: () =>
        launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
    child: Text(label),
  );
}

class _SubmitDialog extends StatefulWidget {
  const _SubmitDialog({this.initial});
  final String? initial;

  @override
  State<_SubmitDialog> createState() => _SubmitDialogState();
}

class _SubmitDialogState extends State<_SubmitDialog> {
  late final _controller = TextEditingController(text: widget.initial);
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final url = _controller.text.trim();
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme || !uri.scheme.startsWith('http')) {
      setState(() => _error = 'Colle le lien complet, commençant par https://');
      return;
    }
    Navigator.pop(context, url);
  }

  @override
  Widget build(BuildContext context) => ShadDialog(
    title: const Text('Lien de ta publication'),
    actions: [
      ShadButton.outline(
        onPressed: () => Navigator.pop(context),
        child: const Text('Annuler'),
      ),
      ShadButton(onPressed: _send, child: const Text('Envoyer')),
    ],
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: ShadInputFormField(
        controller: _controller,
        keyboardType: TextInputType.url,
        autofocus: true,
        placeholder: const Text('https://…'),
        leading: const Icon(LucideIcons.link, size: 16),
        forceErrorText: _error,
      ),
    ),
  );
}

class _Filter extends StatelessWidget {
  const _Filter({
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
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Pressable(
          child: AnimatedContainer(
            duration: VzMotion.of(context, VzMotion.standard),
            curve: VzMotion.easeOut,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: selected ? colors.primary : colors.card,
              borderRadius: BorderRadius.circular(99),
              border: Border.all(
                color: selected ? colors.primary : colors.border,
              ),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 14,
                color: selected ? colors.primaryForeground : colors.foreground,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Turns into a spinner while its action runs, then a green tick.
class _MorphButton extends StatefulWidget {
  const _MorphButton({
    required this.label,
    required this.color,
    required this.onPress,
    this.foreground = VzColors.ink,
  });
  final String label;
  final Color color;
  final Color foreground;

  /// Calls `loading` when the work starts. Returns whether it worked, or
  /// null when the user backed out before anything was sent.
  final Future<bool?> Function(VoidCallback loading) onPress;

  @override
  State<_MorphButton> createState() => _MorphButtonState();
}

enum _Step { idle, loading, done }

class _MorphButtonState extends State<_MorphButton> {
  _Step _step = _Step.idle;

  Future<void> _press() async {
    final ok = await widget.onPress(() {
      if (mounted) setState(() => _step = _Step.loading);
    });
    if (mounted) setState(() => _step = ok == true ? _Step.done : _Step.idle);
  }

  @override
  Widget build(BuildContext context) {
    final wide = VzMotion.of(context, VzMotion.wide);
    final child = switch (_step) {
      _Step.idle => Text(
        widget.label,
        key: const ValueKey('idle'),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      _Step.loading => const SizedBox.square(
        key: ValueKey('loading'),
        dimension: 22,
        child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
      ),
      _Step.done => const Icon(
        LucideIcons.check,
        key: ValueKey('done'),
        color: Colors.white,
      ),
    };
    final background = switch (_step) {
      _Step.idle => widget.color,
      _Step.loading => ShadTheme.of(context).colorScheme.primary,
      _Step.done => VzColors.paid,
    };
    return Pressable(
      child: AnimatedContainer(
        duration: wide,
        curve: VzMotion.easeOut,
        width: _step == _Step.loading ? 56 : 140,
        height: 48,
        child: ShadButton(
          width: double.infinity,
          height: 48,
          padding: EdgeInsets.zero,
          backgroundColor: background,
          hoverBackgroundColor: background,
          pressedBackgroundColor: background,
          foregroundColor: widget.foreground,
          hoverForegroundColor: widget.foreground,
          pressedForegroundColor: widget.foreground,
          decoration: ShadDecoration(
            border: ShadBorder(
              radius: BorderRadius.circular(_step == _Step.loading ? 28 : 14),
            ),
          ),
          onPressed: _step == _Step.idle ? _press : () {},
          // Flexible: the label ellipsizes while the button widens again.
          child: Flexible(
            child: AnimatedSwitcher(
              duration: VzMotion.of(context, VzMotion.standard),
              transitionBuilder: (child, animation) => ScaleTransition(
                scale: CurvedAnimation(
                  parent: animation,
                  curve: VzMotion.spring,
                ),
                child: FadeTransition(opacity: animation, child: child),
              ),
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}
