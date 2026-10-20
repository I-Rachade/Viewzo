import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import 'auth_widgets.dart';

const countries = {
  'TG': 'Togo',
  'BJ': 'Bénin',
  'CI': "Côte d'Ivoire",
  'SN': 'Sénégal',
  'BF': 'Burkina Faso',
  'ML': 'Mali',
  'NE': 'Niger',
  'CM': 'Cameroun',
  'GH': 'Ghana',
  'NG': 'Nigeria',
  'GN': 'Guinée',
  'GA': 'Gabon',
  'CD': 'RD Congo',
  'CG': 'Congo',
  'FR': 'France',
};

const _stepCount = 4;

/// Sign-up in 4 steps: role, e-mail or phone, code, password.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, required this.session});
  final Session session;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen>
    with CodeFormState<RegisterScreen> {
  final _identifier = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  var _step = 0;
  ProfileType? _role;
  var _kind = IdentifierKind.email;
  var _country = 'TG';
  String? _ticket;
  bool _alreadyRegistered = false;

  void _goTo(int step) => setState(() {
    _step = step;
    error = null;
    _alreadyRegistered = false;
  });

  void _back() {
    if (_step == 0) {
      Navigator.of(context).pop();
    } else {
      // The ticket only exists after the code step; going back past it means
      // verifying again.
      _goTo(_step == 3 ? 1 : _step - 1);
    }
  }

  Future<void> _requestCode() => run(() async {
    final identifier = _identifier.text.trim();
    try {
      final to = await widget.session.api.registerStart(identifier);
      codeSent(to, identifier);
      _code.clear();
      _goTo(2);
    } on ApiException catch (e) {
      if (e.statusCode == 409) setState(() => _alreadyRegistered = true);
      rethrow;
    }
  });

  Future<void> _verify() => run(() async {
    final ticket = await widget.session.api.registerVerify(
      sentInput!,
      _code.text.trim(),
    );
    _ticket = ticket;
    _goTo(3);
  });

  Future<void> _complete() => run(() async {
    final user = await widget.session.api.registerComplete(
      ticket: _ticket!,
      password: _password.text,
      role: _role!,
      country: _kind == IdentifierKind.email ? _country : null,
    );
    if (!mounted) return;
    await openHome(context, widget.session, user);
  });

  @override
  void dispose() {
    _identifier.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Créer un compte'),
          leading: IconButton(
            tooltip: 'Retour',
            icon: const Icon(Icons.arrow_back),
            onPressed: _back,
          ),
        ),
        body: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              'Étape ${_step + 1} sur $_stepCount',
              style: theme.textTheme.labelLarge,
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(value: (_step + 1) / _stepCount),
            const SizedBox(height: 24),
            ...switch (_step) {
              0 => _roleStep(theme),
              1 => _identifierStep(),
              2 => _codeStep(theme),
              _ => _passwordStep(),
            },
            errorText(),
            if (_alreadyRegistered)
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Se connecter'),
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _roleStep(ThemeData theme) => [
    _roleCard(
      ProfileType.creator,
      Icons.trending_up,
      "Je veux gagner de l'argent avec mes réseaux",
    ),
    const SizedBox(height: 12),
    _roleCard(
      ProfileType.advertiser,
      Icons.campaign_outlined,
      'Je veux faire connaître ma marque',
    ),
    const SizedBox(height: 12),
    Text(
      "Tu pourras ajouter l'autre profil plus tard.",
      style: theme.textTheme.bodySmall,
    ),
  ];

  Widget _roleCard(ProfileType type, IconData icon, String title) {
    final selected = _role == type;
    final colors = Theme.of(context).colorScheme;
    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: selected ? colors.primary : colors.outlineVariant,
          width: selected ? 2 : 1,
        ),
      ),
      child: InkWell(
        onTap: () {
          _role = type;
          _goTo(1);
        },
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Icon(icon, size: 36, color: colors.primary),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(type.label),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _identifierStep() {
    final locked = lockedFor(_identifier.text);
    return [
      IdentifierInput(
        kind: _kind,
        controller: _identifier,
        onKindChanged: (kind) => setState(() {
          _kind = kind;
          _identifier.clear();
          _alreadyRegistered = false;
        }),
        onChanged: (_) => setState(() => _alreadyRegistered = false),
      ),
      if (_kind == IdentifierKind.email) ...[
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          key: const Key('country'),
          initialValue: _country,
          decoration: const InputDecoration(labelText: 'Pays'),
          items: [
            for (final c in countries.entries)
              DropdownMenuItem(value: c.key, child: Text(c.value)),
          ],
          onChanged: (v) => setState(() => _country = v ?? _country),
        ),
      ],
      const SizedBox(height: 16),
      FilledButton(
        onPressed: busy || locked || _identifier.text.trim().isEmpty
            ? null
            : _requestCode,
        child: Text(
          locked ? 'Nouveau code dans ${formatWait(wait)}' : 'Recevoir un code',
        ),
      ),
      if (locked)
        TextButton(
          onPressed: () => _goTo(2),
          child: const Text("J'ai déjà un code"),
        ),
    ];
  }

  List<Widget> _codeStep(ThemeData theme) => [
    Text('Code envoyé à $sentTo'),
    const SizedBox(height: 8),
    Text(codeHint, style: theme.textTheme.bodySmall),
    const SizedBox(height: 16),
    CodeField(controller: _code),
    FilledButton(
      onPressed: busy ? null : _verify,
      child: const Text('Valider'),
    ),
    resendButton(_requestCode),
    TextButton(
      onPressed: () => _goTo(1),
      child: Text(
        _kind == IdentifierKind.email
            ? "Changer d'adresse e-mail"
            : 'Changer de numéro',
      ),
    ),
  ];

  List<Widget> _passwordStep() => [
    NewPasswordFields(
      password: _password,
      confirm: _confirm,
      onChanged: () => setState(() {}),
    ),
    const SizedBox(height: 24),
    FilledButton(
      onPressed: busy || !NewPasswordFields.valid(_password.text, _confirm.text)
          ? null
          : _complete,
      child: const Text('Créer mon compte'),
    ),
  ];
}
