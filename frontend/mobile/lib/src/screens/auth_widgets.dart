import 'dart:async';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import 'home_screen.dart';

// Codes can take a few minutes to arrive, and every new code cancels the
// previous one, so asking again too early locks people out.
const resendDelay = Duration(minutes: 2);

const codeHint =
    'Le code peut mettre quelques minutes à arriver. '
    'Chaque nouveau code annule le précédent.';

const passwordRule = '8 caractères minimum, avec une lettre et un chiffre';

bool isValidPassword(String password) =>
    password.length >= 8 &&
    RegExp(r'[A-Za-z]').hasMatch(password) &&
    RegExp(r'\d').hasMatch(password);

String formatWait(Duration d) {
  final s = (d.inMilliseconds / 1000).ceil();
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

enum IdentifierKind { email, phone }

/// Opens the home screen once signed in, dropping the auth screens behind it.
Future<void> openHome(
  BuildContext context,
  Session session,
  UserView user,
) async {
  await session.save();
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(
    MaterialPageRoute(
      builder: (_) => HomeScreen(session: session, initialUser: user),
    ),
    (_) => false,
  );
}

/// Busy flag, error message and the 2-minute resend lock shared by the
/// screens that send a code.
mixin CodeFormState<T extends StatefulWidget> on State<T> {
  String? error;
  bool busy = false;
  String? sentTo;
  String? sentInput;
  DateTime? _sentAt;
  Timer? _ticker;

  Duration get wait {
    if (_sentAt == null) return Duration.zero;
    final left = _sentAt!.add(resendDelay).difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }

  bool get waiting => wait > Duration.zero;

  // Only the identifier that just got a code has to wait; a corrected one can
  // ask right away.
  bool lockedFor(String input) => waiting && sentInput == input.trim();

  void codeSent(String to, String input) {
    setState(() {
      sentTo = to;
      sentInput = input.trim();
      _sentAt = DateTime.now();
    });
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!waiting) t.cancel();
      if (mounted) setState(() {});
    });
  }

  Future<void> run(Future<void> Function() action) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (_) {
      if (mounted) setState(() => error = 'Serveur injoignable');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget errorText() => error == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Text(
            error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        );

  Widget resendButton(VoidCallback onResend) => TextButton(
    onPressed: busy || waiting ? null : onResend,
    child: Text(
      waiting
          ? 'Renvoyer le code dans ${formatWait(wait)}'
          : 'Renvoyer le code',
    ),
  );

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }
}

/// "E-mail | Téléphone" toggle with the matching field.
class IdentifierInput extends StatelessWidget {
  const IdentifierInput({
    super.key,
    required this.kind,
    required this.controller,
    required this.onKindChanged,
    this.onChanged,
  });
  final IdentifierKind kind;
  final TextEditingController controller;
  final ValueChanged<IdentifierKind> onKindChanged;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    final email = kind == IdentifierKind.email;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<IdentifierKind>(
          segments: const [
            ButtonSegment(
              value: IdentifierKind.email,
              label: Text('E-mail'),
              icon: Icon(Icons.mail_outline),
            ),
            ButtonSegment(
              value: IdentifierKind.phone,
              label: Text('Téléphone'),
              icon: Icon(Icons.phone_outlined),
            ),
          ],
          selected: {kind},
          onSelectionChanged: (s) => onKindChanged(s.first),
        ),
        const SizedBox(height: 16),
        TextField(
          key: const Key('identifier'),
          controller: controller,
          keyboardType: email
              ? TextInputType.emailAddress
              : TextInputType.phone,
          autofillHints: [
            email ? AutofillHints.email : AutofillHints.telephoneNumber,
          ],
          decoration: InputDecoration(
            labelText: email ? 'Adresse e-mail' : 'Numéro de téléphone',
            hintText: email ? 'nom@exemple.com' : '+228 90 12 34 56',
          ),
          onChanged: onChanged,
        ),
      ],
    );
  }
}

class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    required this.label,
    this.onChanged,
    this.newPassword = false,
  });
  final TextEditingController controller;
  final String label;
  final ValueChanged<String>? onChanged;
  final bool newPassword;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: widget.controller,
      obscureText: !_visible,
      autofillHints: [
        widget.newPassword ? AutofillHints.newPassword : AutofillHints.password,
      ],
      decoration: InputDecoration(
        labelText: widget.label,
        suffixIcon: IconButton(
          tooltip: _visible
              ? 'Masquer le mot de passe'
              : 'Afficher le mot de passe',
          icon: Icon(_visible ? Icons.visibility_off : Icons.visibility),
          onPressed: () => setState(() => _visible = !_visible),
        ),
      ),
      onChanged: widget.onChanged,
    );
  }
}

/// New password + confirmation with the rule shown live.
class NewPasswordFields extends StatelessWidget {
  const NewPasswordFields({
    super.key,
    required this.password,
    required this.confirm,
    required this.onChanged,
  });
  final TextEditingController password;
  final TextEditingController confirm;
  final VoidCallback onChanged;

  static bool valid(String password, String confirm) =>
      isValidPassword(password) && password == confirm;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ruleBroken =
        password.text.isNotEmpty && !isValidPassword(password.text);
    final mismatch = confirm.text.isNotEmpty && confirm.text != password.text;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PasswordField(
          key: const Key('password'),
          controller: password,
          label: 'Mot de passe',
          newPassword: true,
          onChanged: (_) => onChanged(),
        ),
        const SizedBox(height: 4),
        Text(
          passwordRule,
          style: theme.textTheme.bodySmall?.copyWith(
            color: ruleBroken ? theme.colorScheme.error : null,
          ),
        ),
        const SizedBox(height: 12),
        PasswordField(
          key: const Key('confirm'),
          controller: confirm,
          label: 'Confirme le mot de passe',
          newPassword: true,
          onChanged: (_) => onChanged(),
        ),
        if (mismatch) ...[
          const SizedBox(height: 4),
          Text(
            'Les mots de passe ne correspondent pas',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.error,
            ),
          ),
        ],
      ],
    );
  }
}

/// The 6-digit code field.
class CodeField extends StatelessWidget {
  const CodeField({super.key, required this.controller});
  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: const Key('code'),
      controller: controller,
      keyboardType: TextInputType.number,
      maxLength: 6,
      autofillHints: const [AutofillHints.oneTimeCode],
      decoration: const InputDecoration(labelText: 'Code à 6 chiffres'),
    );
  }
}
