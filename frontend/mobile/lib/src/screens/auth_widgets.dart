import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../session.dart';
import '../ui/theme.dart';
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
          child: ShadAlert.destructive(
            icon: const Icon(LucideIcons.circleAlert),
            title: Text(error!),
            titleStyle: const TextStyle(height: 1.35),
          ),
        );

  Widget resendButton(VoidCallback onResend) => ShadButton.ghost(
    width: double.infinity,
    enabled: !busy && !waiting,
    onPressed: busy || waiting ? null : onResend,
    child: Flexible(
      child: Text(
        waiting
            ? 'Renvoyer le code dans ${formatWait(wait)}'
            : 'Renvoyer le code',
        overflow: TextOverflow.ellipsis,
      ),
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
        _KindBar(value: kind, onChanged: onKindChanged),
        const SizedBox(height: 20),
        ShadInputFormField(
          key: const Key('identifier'),
          controller: controller,
          keyboardType: email
              ? TextInputType.emailAddress
              : TextInputType.phone,
          autofillHints: [
            email ? AutofillHints.email : AutofillHints.telephoneNumber,
          ],
          label: Text(email ? 'Adresse e-mail' : 'Numéro de téléphone'),
          placeholder: Text(email ? 'nom@exemple.com' : '+228 90 12 34 56'),
          leading: Icon(
            email ? LucideIcons.mail : LucideIcons.phone,
            size: 18,
            color: ShadTheme.of(context).colorScheme.mutedForeground,
          ),
          onChanged: onChanged,
        ),
      ],
    );
  }
}

/// E-mail or phone: a segmented control in the iOS manner, like the wallet
/// filter.
class _KindBar extends StatelessWidget {
  const _KindBar({required this.value, required this.onChanged});
  final IdentifierKind value;
  final ValueChanged<IdentifierKind> onChanged;

  static const _labels = {
    IdentifierKind.email: 'E-mail',
    IdentifierKind.phone: 'Téléphone',
  };
  static const _icons = {
    IdentifierKind.email: LucideIcons.mail,
    IdentifierKind.phone: LucideIcons.phone,
  };

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
          for (final k in IdentifierKind.values)
            Expanded(
              child: Semantics(
                button: true,
                selected: k == value,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onChanged(k),
                  child: AnimatedContainer(
                    duration: VzMotion.of(context, VzMotion.standard),
                    curve: VzMotion.easeOut,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: k == value ? colors.card : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                      boxShadow: k == value
                          ? const [
                              BoxShadow(
                                color: Color(0x14000000),
                                blurRadius: 8,
                                offset: Offset(0, 2),
                              ),
                            ]
                          : null,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      spacing: 8,
                      children: [
                        Icon(
                          _icons[k],
                          size: 16,
                          color: k == value
                              ? colors.foreground
                              : colors.mutedForeground,
                        ),
                        Flexible(
                          child: Text(
                            _labels[k]!,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.small.copyWith(
                              fontWeight: FontWeight.w700,
                              color: k == value
                                  ? colors.foreground
                                  : colors.mutedForeground,
                            ),
                          ),
                        ),
                      ],
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
    final muted = ShadTheme.of(context).colorScheme.mutedForeground;
    return ShadInputFormField(
      controller: widget.controller,
      obscureText: !_visible,
      autofillHints: [
        widget.newPassword ? AutofillHints.newPassword : AutofillHints.password,
      ],
      label: Text(widget.label),
      leading: Icon(LucideIcons.lock, size: 18, color: muted),
      trailing: Tooltip(
        message: _visible
            ? 'Masquer le mot de passe'
            : 'Afficher le mot de passe',
        child: ShadIconButton.ghost(
          width: 32,
          height: 32,
          padding: EdgeInsets.zero,
          icon: Icon(
            _visible ? LucideIcons.eyeOff : LucideIcons.eye,
            size: 18,
            color: muted,
          ),
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
    final theme = ShadTheme.of(context);
    final ruleBroken =
        password.text.isNotEmpty && !isValidPassword(password.text);
    final mismatch = confirm.text.isNotEmpty && confirm.text != password.text;
    final hint = theme.textTheme.muted.copyWith(fontSize: 13);
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
        const SizedBox(height: 6),
        Text(
          passwordRule,
          style: hint.copyWith(
            color: ruleBroken ? theme.colorScheme.destructive : null,
          ),
        ),
        const SizedBox(height: 16),
        PasswordField(
          key: const Key('confirm'),
          controller: confirm,
          label: 'Confirme le mot de passe',
          newPassword: true,
          onChanged: (_) => onChanged(),
        ),
        if (mismatch) ...[
          const SizedBox(height: 6),
          Text(
            'Les mots de passe ne correspondent pas',
            style: hint.copyWith(color: theme.colorScheme.destructive),
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
    return ShadInputFormField(
      key: const Key('code'),
      controller: controller,
      keyboardType: TextInputType.number,
      maxLength: 6,
      autofillHints: const [AutofillHints.oneTimeCode],
      label: const Text('Code à 6 chiffres'),
      style: const TextStyle(
        fontFamily: 'Sora',
        fontSize: 20,
        fontWeight: FontWeight.w700,
        letterSpacing: 6,
      ),
    );
  }
}
