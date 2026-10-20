import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../session.dart';
import '../ui/widgets.dart';
import 'auth_widgets.dart';

/// Resets a forgotten password, or sets one for accounts created before
/// passwords existed.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({
    super.key,
    required this.session,
    this.initialIdentifier,
    this.title = 'Mot de passe oublié',
  });
  final Session session;
  final String? initialIdentifier;
  final String title;

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen>
    with CodeFormState<ForgotPasswordScreen> {
  final _identifier = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  var _kind = IdentifierKind.email;
  bool _enteringCode = false;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialIdentifier ?? '';
    _identifier.text = initial;
    if (initial.isNotEmpty && !initial.contains('@')) {
      _kind = IdentifierKind.phone;
    }
  }

  Future<void> _requestCode() => run(() async {
    final identifier = _identifier.text.trim();
    final to = await widget.session.api.forgotPassword(identifier);
    codeSent(to, identifier);
    _code.clear();
    setState(() => _enteringCode = true);
  });

  Future<void> _save() => run(() async {
    final user = await widget.session.api.resetPassword(
      sentInput!,
      _code.text.trim(),
      _password.text,
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
    final locked = lockedFor(_identifier.text);
    final theme = ShadTheme.of(context);
    final canSave =
        !busy && NewPasswordFields.valid(_password.text, _confirm.text);
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        children: [
          if (!_enteringCode) ...[
            FadeSlideIn(
              child: IdentifierInput(
                kind: _kind,
                controller: _identifier,
                onKindChanged: (kind) => setState(() {
                  _kind = kind;
                  _identifier.clear();
                }),
                onChanged: (_) => setState(() {}),
              ),
            ),
            const SizedBox(height: 28),
            Pressable(
              child: ShadButton(
                size: ShadButtonSize.lg,
                width: double.infinity,
                enabled: !busy && !locked,
                onPressed: busy || locked ? null : _requestCode,
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
                onPressed: () => setState(() => _enteringCode = true),
                child: const Flexible(
                  child: Text(
                    "J'ai déjà un code",
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
          ] else ...[
            Text(
              'Code envoyé à $sentTo',
              style: theme.textTheme.p.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Text(codeHint, style: theme.textTheme.muted.copyWith(fontSize: 13)),
            const SizedBox(height: 20),
            CodeField(controller: _code),
            const SizedBox(height: 16),
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
                enabled: canSave,
                onPressed: canSave ? _save : null,
                child: const Flexible(
                  child: Text(
                    'Enregistrer le mot de passe',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            resendButton(_requestCode),
            ShadButton.ghost(
              width: double.infinity,
              onPressed: () => setState(() => _enteringCode = false),
              child: const Flexible(
                child: Text(
                  "Changer d'identifiant",
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
          errorText(),
        ],
      ),
    );
  }
}
