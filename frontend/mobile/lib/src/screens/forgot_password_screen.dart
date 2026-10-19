import 'package:flutter/material.dart';

import '../session.dart';
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
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          if (!_enteringCode) ...[
            IdentifierInput(
              kind: _kind,
              controller: _identifier,
              onKindChanged: (kind) => setState(() {
                _kind = kind;
                _identifier.clear();
              }),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy || locked ? null : _requestCode,
              child: Text(
                locked
                    ? 'Nouveau code dans ${formatWait(wait)}'
                    : 'Recevoir un code',
              ),
            ),
            if (locked)
              TextButton(
                onPressed: () => setState(() => _enteringCode = true),
                child: const Text("J'ai déjà un code"),
              ),
          ] else ...[
            Text('Code envoyé à $sentTo'),
            const SizedBox(height: 8),
            Text(codeHint, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 16),
            CodeField(controller: _code),
            NewPasswordFields(
              password: _password,
              confirm: _confirm,
              onChanged: () => setState(() {}),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed:
                  busy ||
                      !NewPasswordFields.valid(_password.text, _confirm.text)
                  ? null
                  : _save,
              child: const Text('Enregistrer le mot de passe'),
            ),
            resendButton(_requestCode),
            TextButton(
              onPressed: () => setState(() => _enteringCode = false),
              child: const Text("Changer d'identifiant"),
            ),
          ],
          errorText(),
        ],
      ),
    );
  }
}
