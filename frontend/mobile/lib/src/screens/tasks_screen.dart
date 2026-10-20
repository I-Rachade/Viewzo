import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
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
    final url = await showDialog<String>(
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
    final views = await showDialog<int>(
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
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Tâches'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Disponibles'),
              Tab(text: 'Mes tâches'),
            ],
          ),
        ),
        body: Column(
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            Expanded(
              child: TabBarView(
                children: [_availableList(), _assignmentList()],
              ),
            ),
          ],
        ),
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
            const Text(
              'Aucune tâche pour toi en ce moment. Vérifie que tes comptes '
              'sont éligibles et que tes compétences sont à jour.',
            ),
          if (networks.length > 1)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
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
          for (final (i, task) in shown.indexed)
            FadeSlideIn(
              key: ValueKey(task.id),
              index: i,
              child: _TaskCard(
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
            const Text('Tu n’as pas encore accepté de tâche.'),
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
    final screenshot = FilledButton.tonalIcon(
      icon: const Icon(Icons.add_photo_alternate_outlined),
      label: Text(statut ? 'Envoyer une capture' : 'Ajouter une capture'),
      onPressed: () => _sendScreenshot(a),
    );
    if (statut) return screenshot;
    if (!a.submitted) {
      return _MorphButton(
        label: 'J’ai publié',
        color: Theme.of(context).colorScheme.primary,
        foreground: Theme.of(context).colorScheme.onPrimary,
        onPress: (loading) => _submit(a, loading),
      );
    }
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      alignment: WrapAlignment.end,
      children: [
        if (a.reviewStatus != ReviewStatus.validated)
          OutlinedButton(
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

String _time(DateTime d) =>
    '${_date(d)} à ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

/// Totals of what the team validated and paid, on top of "Mes tâches".
class _ResultsCard extends StatelessWidget {
  const _ResultsCard({required this.results});
  final CreatorResults results;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    Widget stat(String label, String value) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: text.bodySmall),
          Text(value, style: text.titleMedium),
        ],
      ),
    );
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 10,
          children: [
            Text('Mes résultats', style: text.titleMedium),
            Row(
              children: [
                stat('Vues validées', _views(results.validViews)),
                stat(
                  'Gagné ce mois',
                  '${_views(results.earnedThisMonth)} FCFA',
                ),
              ],
            ),
            Row(
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
            Text(
              '${results.toReview} en vérification · ${results.needsFix} à '
              'corriger · ${results.validated} validées · '
              '${results.rejected} refusées',
              style: text.bodySmall,
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
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 6,
      children: [
        if (a.reviewReason != null)
          Text(a.reviewReason!, style: TextStyle(color: scheme.error)),
        if (a.submitted || a.screenshots > 0)
          Text(
            [
              '${_views(a.validViews)} vues validées',
              '${_views(a.earned)} FCFA gagnés',
              if (a.declaredViews != null && a.declaredViews != a.validViews)
                '${_views(a.declaredViews!)} déclarées',
            ].join(' · '),
          ),
        for (final (i, step) in a.proofSteps.indexed)
          Row(
            spacing: 10,
            children: [
              CircleAvatar(
                radius: 12,
                backgroundColor: step.doneAt != null
                    ? VzColors.paid
                    : scheme.primaryContainer,
                child: step.doneAt != null
                    ? const Icon(Icons.check, size: 14, color: Colors.white)
                    : Text('${i + 1}', style: text.labelSmall),
              ),
              Expanded(
                child: Text(
                  '${step.label} · ${switch ((step.doneAt, step.dueAt)) {
                    (final done?, _) => 'envoyée le ${_time(done)}',
                    (null, final due?) => 'à envoyer vers le ${_time(due)}',
                    _ => 'dès que ton statut est publié',
                  }}',
                ),
              ),
            ],
          ),
      ],
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
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Vues sur la capture'),
    content: TextField(
      controller: _controller,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      autofocus: true,
      decoration: InputDecoration(hintText: 'Ex. : 350', errorText: _error),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Annuler'),
      ),
      FilledButton(onPressed: _send, child: const Text('Envoyer')),
    ],
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
    final text = Theme.of(context).textTheme;
    final duration = switch ((brief.minDurationSec, brief.maxDurationSec)) {
      (null, null) => null,
      (final min?, null) => 'au moins $min s',
      (null, final max?) => 'au plus $max s',
      (final min?, final max?) => '$min à $max s',
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 6,
          children: [
            Row(
              children: [
                Expanded(child: Text(brief.title, style: text.titleMedium)),
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
                Text(task.contentType.label, style: text.bodyMedium),
              ],
            ),
            Text(
              '${task.ratePer1000} FCFA pour 1 000 vues · '
              'jusqu’au ${_date(brief.endsAt)}',
              style: text.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: Theme.of(context).brightness == Brightness.dark
                    ? const Color(0xFF7BE0B0)
                    : VzColors.paidText,
              ),
            ),
            Row(
              children: [
                Text('Hashtag obligatoire : ${brief.hashtag}'),
                IconButton(
                  icon: const Icon(Icons.copy, size: 18),
                  tooltip: 'Copier',
                  onPressed: () =>
                      Clipboard.setData(ClipboardData(text: brief.hashtag)),
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
            ),
            if (brief.mandatoryElements.isNotEmpty)
              Text('À inclure : ${brief.mandatoryElements.join(', ')}'),
            if (brief.forbiddenElements.isNotEmpty)
              Text('Interdit : ${brief.forbiddenElements.join(', ')}'),
            for (final (i, url) in brief.assetUrls.indexed)
              _LinkButton(label: 'Élément ${i + 1}', url: url),
            for (final (i, url) in brief.examples.indexed)
              _LinkButton(label: 'Exemple ${i + 1}', url: url),
            ?details,
            if (action != null)
              Align(alignment: Alignment.centerRight, child: action),
          ],
        ),
      ),
    );
  }
}

class _LinkButton extends StatelessWidget {
  const _LinkButton({required this.label, required this.url});
  final String label;
  final String url;

  @override
  Widget build(BuildContext context) => TextButton.icon(
    icon: const Icon(Icons.open_in_new, size: 18),
    label: Text(label),
    onPressed: () =>
        launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
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
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Lien de ta publication'),
    content: TextField(
      controller: _controller,
      keyboardType: TextInputType.url,
      autofocus: true,
      decoration: InputDecoration(hintText: 'https://…', errorText: _error),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Annuler'),
      ),
      FilledButton(onPressed: _send, child: const Text('Envoyer')),
    ],
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
    final scheme = Theme.of(context).colorScheme;
    return Pressable(
      child: AnimatedContainer(
        duration: VzMotion.of(context, VzMotion.standard),
        curve: VzMotion.easeOut,
        decoration: BoxDecoration(
          color: selected ? scheme.primary : scheme.surface,
          borderRadius: BorderRadius.circular(99),
          border: Border.all(color: selected ? scheme.primary : scheme.outline),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(99),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: selected ? scheme.onPrimary : scheme.onSurface,
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
      _Step.idle => Text(widget.label, key: const ValueKey('idle')),
      _Step.loading => const SizedBox.square(
        key: ValueKey('loading'),
        dimension: 22,
        child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
      ),
      _Step.done => const Icon(
        Icons.check_rounded,
        key: ValueKey('done'),
        color: Colors.white,
      ),
    };
    return Pressable(
      child: AnimatedContainer(
        duration: wide,
        curve: VzMotion.easeOut,
        width: _step == _Step.loading ? 56 : 140,
        height: 48,
        child: FilledButton(
          style: FilledButton.styleFrom(
            padding: EdgeInsets.zero,
            backgroundColor: switch (_step) {
              _Step.idle => widget.color,
              _Step.loading => Theme.of(context).colorScheme.primary,
              _Step.done => VzColors.paid,
            },
            foregroundColor: widget.foreground,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(
                _step == _Step.loading ? 28 : 14,
              ),
            ),
          ),
          onPressed: _step == _Step.idle ? _press : () {},
          child: AnimatedSwitcher(
            duration: VzMotion.of(context, VzMotion.standard),
            transitionBuilder: (child, animation) => ScaleTransition(
              scale: CurvedAnimation(parent: animation, curve: VzMotion.spring),
              child: FadeTransition(opacity: animation, child: child),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}
