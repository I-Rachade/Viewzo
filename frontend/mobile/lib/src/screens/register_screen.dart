import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
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
    final theme = ShadTheme.of(context);
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Créer un compte'),
          leading: Tooltip(
            message: 'Retour',
            child: ShadIconButton.ghost(
              icon: const Icon(LucideIcons.arrowLeft, size: 22),
              onPressed: _back,
            ),
          ),
        ),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
          children: [
            Text(
              'Étape ${_step + 1} sur $_stepCount',
              style: theme.textTheme.small.copyWith(
                color: theme.colorScheme.mutedForeground,
              ),
            ),
            const SizedBox(height: 10),
            TweenAnimationBuilder<double>(
              tween: Tween(end: (_step + 1) / _stepCount),
              duration: VzMotion.of(context, VzMotion.standard),
              curve: VzMotion.easeOut,
              builder: (context, value, _) =>
                  ShadProgress(value: value, minHeight: 6),
            ),
            const SizedBox(height: 28),
            // A new key per step replays the entrance on each step.
            KeyedSubtree(
              key: ValueKey(_step),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ...switch (_step) {
                    0 => _roleStep(theme),
                    1 => _identifierStep(),
                    2 => _codeStep(theme),
                    _ => _passwordStep(),
                  },
                ],
              ),
            ),
            errorText(),
            if (_alreadyRegistered) ...[
              const SizedBox(height: 8),
              ShadButton.outline(
                width: double.infinity,
                onPressed: () => Navigator.of(context).pop(),
                child: const Flexible(
                  child: Text('Se connecter', overflow: TextOverflow.ellipsis),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _roleStep(ShadThemeData theme) => [
    FadeSlideIn(
      child: _roleCard(
        ProfileType.creator,
        LucideIcons.trendingUp,
        "Je veux gagner de l'argent avec mes réseaux",
      ),
    ),
    const SizedBox(height: 12),
    FadeSlideIn(
      index: 1,
      child: _roleCard(
        ProfileType.advertiser,
        LucideIcons.megaphone,
        'Je veux faire connaître ma marque',
      ),
    ),
    const SizedBox(height: 16),
    Text(
      "Tu pourras ajouter l'autre profil plus tard.",
      style: theme.textTheme.muted.copyWith(fontSize: 13),
    ),
  ];

  Widget _roleCard(ProfileType type, IconData icon, String title) {
    final selected = _role == type;
    final theme = ShadTheme.of(context);
    final colors = theme.colorScheme;
    return Pressable(
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          _role = type;
          _goTo(1);
        },
        child: Semantics(
          button: true,
          selected: selected,
          child: ShadCard(
            padding: const EdgeInsets.all(20),
            radius: BorderRadius.circular(18),
            border: ShadBorder.all(
              color: selected ? colors.primary : colors.border,
              width: selected ? 2 : 1,
            ),
            child: Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: colors.secondary,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(icon, size: 26, color: colors.primary),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: theme.textTheme.p.copyWith(
                          fontFamily: 'Sora',
                          fontWeight: FontWeight.w600,
                          height: 1.3,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(type.label, style: theme.textTheme.muted),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  LucideIcons.chevronRight,
                  size: 20,
                  color: colors.mutedForeground,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _identifierStep() {
    final locked = lockedFor(_identifier.text);
    final canSend = !busy && !locked && _identifier.text.trim().isNotEmpty;
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
        _CountryField(
          value: _country,
          onChanged: (v) => setState(() => _country = v ?? _country),
        ),
      ],
      const SizedBox(height: 28),
      Pressable(
        child: ShadButton(
          size: ShadButtonSize.lg,
          width: double.infinity,
          enabled: canSend,
          onPressed: canSend ? _requestCode : null,
          child: Flexible(
            child: Text(
              locked
                  ? 'Nouveau code dans ${formatWait(wait)}'
                  : 'Recevoir un code',
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
      ),
      if (locked) ...[
        const SizedBox(height: 8),
        ShadButton.ghost(
          width: double.infinity,
          onPressed: () => _goTo(2),
          child: const Flexible(
            child: Text("J'ai déjà un code", overflow: TextOverflow.ellipsis),
          ),
        ),
      ],
    ];
  }

  List<Widget> _codeStep(ShadThemeData theme) => [
    Text(
      'Code envoyé à $sentTo',
      style: theme.textTheme.p.copyWith(fontWeight: FontWeight.w600),
    ),
    const SizedBox(height: 6),
    Text(codeHint, style: theme.textTheme.muted.copyWith(fontSize: 13)),
    const SizedBox(height: 20),
    CodeField(controller: _code),
    const SizedBox(height: 24),
    Pressable(
      child: ShadButton(
        size: ShadButtonSize.lg,
        width: double.infinity,
        enabled: !busy,
        onPressed: busy ? null : _verify,
        child: const Flexible(
          child: Text('Valider', overflow: TextOverflow.ellipsis),
        ),
      ),
    ),
    const SizedBox(height: 8),
    resendButton(_requestCode),
    ShadButton.ghost(
      width: double.infinity,
      onPressed: () => _goTo(1),
      child: Flexible(
        child: Text(
          _kind == IdentifierKind.email
              ? "Changer d'adresse e-mail"
              : 'Changer de numéro',
          overflow: TextOverflow.ellipsis,
        ),
      ),
    ),
  ];

  List<Widget> _passwordStep() {
    final canCreate =
        !busy && NewPasswordFields.valid(_password.text, _confirm.text);
    return [
      NewPasswordFields(
        password: _password,
        confirm: _confirm,
        onChanged: () => setState(() {}),
      ),
      const SizedBox(height: 28),
      Pressable(
        child: ShadButton(
          size: ShadButtonSize.lg,
          width: double.infinity,
          enabled: canCreate,
          onPressed: canCreate ? _complete : null,
          child: const Flexible(
            child: Text('Créer mon compte', overflow: TextOverflow.ellipsis),
          ),
        ),
      ),
    ];
  }
}

/// The country of an e-mail sign-up, phone numbers carrying their own.
class _CountryField extends StatelessWidget {
  const _CountryField({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 8,
      children: [
        Text('Pays', style: theme.textTheme.small),
        ShadSelect<String>(
          key: const Key('country'),
          initialValue: value,
          maxHeight: 320,
          options: [
            for (final c in countries.entries)
              ShadOption(value: c.key, child: Text(c.value)),
          ],
          selectedOptionBuilder: (context, v) => Text(countries[v] ?? v),
          onChanged: onChanged,
        ),
      ],
    );
  }
}
