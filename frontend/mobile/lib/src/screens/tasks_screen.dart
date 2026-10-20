import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../task_models.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Tasks the creator can take, and the ones they accepted with the link to
/// submit once posted.
class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  List<CampaignTask>? _available;
  List<Assignment>? _assignments;
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

  Future<void> _accept(CampaignTask task) => _run(() async {
    await widget.api.acceptTask(task.id);
    await _load();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Tâche acceptée, retrouve-la dans Mes tâches'),
        ),
      );
    }
  });

  Future<void> _submit(Assignment assignment) async {
    final url = await showDialog<String>(
      context: context,
      builder: (_) => _SubmitDialog(initial: assignment.postUrl),
    );
    if (url == null) return;
    await _run(() async {
      await widget.api.submitPost(assignment.id, url);
      await _load();
    });
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
    if (tasks == null) return const Center(child: CircularProgressIndicator());
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
          for (final (i, task) in tasks.indexed)
            FadeSlideIn(
              index: i,
              child: _TaskCard(
                task: task,
                action: _AcceptButton(
                  onAccept: () async {
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
    if (assignments == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (assignments.isEmpty)
            const Text('Tu n’as pas encore accepté de tâche.'),
          for (final (i, a) in assignments.indexed)
            FadeSlideIn(
              index: i,
              child: _TaskCard(
                task: a.task,
                status: a.submitted ? 'Lien envoyé' : 'À publier',
                action: a.submitted
                    ? OutlinedButton(
                        onPressed: () => _submit(a),
                        child: const Text('Modifier le lien'),
                      )
                    : FilledButton(
                        onPressed: () => _submit(a),
                        child: const Text('J’ai publié'),
                      ),
              ),
            ),
        ],
      ),
    );
  }
}

String _date(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

class _TaskCard extends StatelessWidget {
  const _TaskCard({required this.task, required this.action, this.status});
  final CampaignTask task;
  final Widget action;
  final String? status;

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
                if (status != null)
                  Pill(
                    status!,
                    tone: status == 'Lien envoyé'
                        ? PillTone.pending
                        : PillTone.violet,
                  ),
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

/// Turns into a spinner while the task is being accepted, then a green tick.
class _AcceptButton extends StatefulWidget {
  const _AcceptButton({required this.onAccept});

  /// Returns whether the task was accepted.
  final Future<bool> Function() onAccept;

  @override
  State<_AcceptButton> createState() => _AcceptButtonState();
}

enum _Step { idle, loading, done }

class _AcceptButtonState extends State<_AcceptButton> {
  _Step _step = _Step.idle;

  Future<void> _press() async {
    setState(() => _step = _Step.loading);
    final accepted = await widget.onAccept();
    if (mounted) setState(() => _step = accepted ? _Step.done : _Step.idle);
  }

  @override
  Widget build(BuildContext context) {
    final wide = VzMotion.of(context, VzMotion.wide);
    final child = switch (_step) {
      _Step.idle => const Text('Accepter', key: ValueKey('idle')),
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
        width: _step == _Step.loading ? 56 : 132,
        height: 48,
        child: FilledButton(
          style: FilledButton.styleFrom(
            padding: EdgeInsets.zero,
            backgroundColor: switch (_step) {
              _Step.idle => VzColors.coral,
              _Step.loading => Theme.of(context).colorScheme.primary,
              _Step.done => VzColors.paid,
            },
            foregroundColor: VzColors.ink,
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
