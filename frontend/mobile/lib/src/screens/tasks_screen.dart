import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../task_models.dart';

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
          for (final task in tasks)
            _TaskCard(
              task: task,
              action: FilledButton(
                onPressed: () => _accept(task),
                child: const Text('Accepter'),
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
          for (final a in assignments)
            _TaskCard(
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
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 6,
          children: [
            Row(
              children: [
                Expanded(child: Text(brief.title, style: text.titleMedium)),
                if (status != null) Chip(label: Text(status!)),
              ],
            ),
            Text(
              '${task.network.label} · ${task.contentType.label}',
              style: text.bodyMedium,
            ),
            Text(
              '${task.ratePer1000} FCFA pour 1 000 vues · '
              'jusqu’au ${_date(brief.endsAt)}',
              style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
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
