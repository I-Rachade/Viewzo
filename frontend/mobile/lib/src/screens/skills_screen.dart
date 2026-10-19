import 'package:flutter/material.dart';

import '../api_client.dart';
import '../creator_models.dart';

/// The creator skills form; tasks are only offered for the skills declared here.
class SkillsScreen extends StatefulWidget {
  const SkillsScreen({super.key, required this.api, required this.country});
  final ApiClient api;
  // Prefills the countries where the creator can shoot.
  final String country;

  @override
  State<SkillsScreen> createState() => _SkillsScreenState();
}

class _SkillsScreenState extends State<SkillsScreen> {
  bool _loading = true;
  bool _busy = false;
  String? _error;

  final _taskTypes = <CreatorTaskType>{};
  final _specialties = <CreatorSpecialty>{};
  final _themes = <String>{};
  bool _showsFace = false;
  final _phoneModel = TextEditingController();
  final _microphone = TextEditingController();
  final _lighting = TextEditingController();
  final _editingSoftware = TextEditingController();
  final _exampleLinks = TextEditingController();
  final _languages = TextEditingController(text: 'Français');
  late final _countries = TextEditingController(text: widget.country);
  final _cities = TextEditingController();
  final _tasksPerWeek = TextEditingController(text: '3');

  List<TextEditingController> get _fields => [
    _phoneModel,
    _microphone,
    _lighting,
    _editingSoftware,
    _exampleLinks,
    _languages,
    _countries,
    _cities,
    _tasksPerWeek,
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final field in _fields) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final skills = await widget.api.skills();
      if (skills != null) _fill(skills);
    } on ApiException catch (e) {
      _error = e.message;
    } catch (_) {
      _error = 'Serveur injoignable';
    }
    if (mounted) setState(() => _loading = false);
  }

  void _fill(CreatorSkills s) {
    _taskTypes.addAll(s.taskTypes);
    _specialties.addAll(s.specialties);
    _themes.addAll(s.themes);
    _showsFace = s.showsFace;
    _phoneModel.text = s.phoneModel ?? '';
    _microphone.text = s.microphone ?? '';
    _lighting.text = s.lighting ?? '';
    _editingSoftware.text = s.editingSoftware ?? '';
    _exampleLinks.text = s.exampleLinks.join('\n');
    _languages.text = s.languages.join(', ');
    _countries.text = s.countries.join(', ');
    _cities.text = s.cities.join(', ');
    _tasksPerWeek.text = '${s.tasksPerWeek}';
  }

  List<String> _split(TextEditingController field, Pattern separator) => [
    for (final part in field.text.split(separator))
      if (part.trim().isNotEmpty) part.trim(),
  ];

  String? _optional(TextEditingController field) =>
      field.text.trim().isEmpty ? null : field.text.trim();

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.saveSkills(
        CreatorSkills(
          taskTypes: _taskTypes,
          specialties: _taskTypes.contains(CreatorTaskType.createVideo)
              ? _specialties
              : {},
          showsFace: _showsFace,
          phoneModel: _optional(_phoneModel),
          microphone: _optional(_microphone),
          lighting: _optional(_lighting),
          editingSoftware: _optional(_editingSoftware),
          exampleLinks: _split(_exampleLinks, RegExp(r'\s+')),
          languages: _split(_languages, ','),
          countries: [for (final c in _split(_countries, ',')) c.toUpperCase()],
          cities: _split(_cities, ','),
          themes: _themes.toList(),
          tasksPerWeek: int.tryParse(_tasksPerWeek.text.trim()) ?? 0,
        ),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Compétences enregistrées')));
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Serveur injoignable');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final createsVideos = _taskTypes.contains(CreatorTaskType.createVideo);
    return Scaffold(
      appBar: AppBar(title: const Text('Mes compétences')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _section('Types de tâches acceptés'),
                for (final type in CreatorTaskType.values)
                  CheckboxListTile(
                    value: _taskTypes.contains(type),
                    title: Text(type.label),
                    contentPadding: EdgeInsets.zero,
                    onChanged: (on) => setState(
                      () =>
                          on! ? _taskTypes.add(type) : _taskTypes.remove(type),
                    ),
                  ),
                if (createsVideos) ...[
                  _section('Spécialités'),
                  _chips(CreatorSpecialty.values, (s) => s.label, _specialties),
                ],
                SwitchListTile(
                  value: _showsFace,
                  title: const Text('J’accepte de montrer mon visage'),
                  contentPadding: EdgeInsets.zero,
                  onChanged: (on) => setState(() => _showsFace = on),
                ),
                _section('Matériel'),
                _field(_phoneModel, 'Téléphone ou caméra (marque et modèle)'),
                _field(_microphone, 'Micro'),
                _field(_lighting, 'Éclairage'),
                _field(_editingSoftware, 'Logiciel de montage (CapCut…)'),
                _section('Exemples'),
                _field(
                  _exampleLinks,
                  createsVideos
                      ? '3 à 5 liens de tes vidéos, un par ligne'
                      : 'Liens de tes vidéos (facultatif), un par ligne',
                  maxLines: 5,
                ),
                _section('Langues et zones'),
                _field(_languages, 'Langues parlées en vidéo (virgules)'),
                _field(_countries, 'Pays où tu peux tourner (TG, BJ…)'),
                _field(_cities, 'Villes (virgules)'),
                _section('Thématiques'),
                _chips(creatorThemes, (t) => t, _themes),
                _section('Disponibilité'),
                _field(
                  _tasksPerWeek,
                  'Nombre de tâches possibles par semaine',
                  keyboardType: TextInputType.number,
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy ? null : _save,
                  child: const Text('Enregistrer'),
                ),
              ],
            ),
    );
  }

  Widget _section(String title) => Padding(
    padding: const EdgeInsets.only(top: 16, bottom: 8),
    child: Text(title, style: Theme.of(context).textTheme.titleMedium),
  );

  Widget _field(
    TextEditingController controller,
    String label, {
    int maxLines = 1,
    TextInputType? keyboardType,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextField(
      controller: controller,
      maxLines: maxLines,
      keyboardType: keyboardType,
      decoration: InputDecoration(labelText: label),
    ),
  );

  Widget _chips<T>(
    List<T> options,
    String Function(T) label,
    Set<T> selected,
  ) => Wrap(
    spacing: 8,
    runSpacing: 4,
    children: [
      for (final option in options)
        FilterChip(
          label: Text(label(option)),
          selected: selected.contains(option),
          onSelected: (on) => setState(
            () => on ? selected.add(option) : selected.remove(option),
          ),
        ),
    ],
  );
}
