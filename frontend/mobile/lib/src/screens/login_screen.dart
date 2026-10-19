import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import 'auth_widgets.dart';
import 'forgot_password_screen.dart';
import 'register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session});
  final Session session;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen>
    with CodeFormState<LoginScreen> {
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  var _kind = IdentifierKind.email;

  Future<void> _login() => run(() async {
    final identifier = _identifier.text.trim();
    try {
      final user = await widget.session.api.login(identifier, _password.text);
      if (!mounted) return;
      await openHome(context, widget.session, user);
    } on ApiException catch (e) {
      if (e.code != 'PASSWORD_NOT_SET') rethrow;
      if (!mounted) return;
      _open(
        ForgotPasswordScreen(
          session: widget.session,
          initialIdentifier: identifier,
          title: 'Définis ton mot de passe',
        ),
      );
    }
  });

  void _open(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connexion')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          IdentifierInput(
            kind: _kind,
            controller: _identifier,
            onKindChanged: (kind) => setState(() {
              _kind = kind;
              _identifier.clear();
            }),
          ),
          const SizedBox(height: 16),
          PasswordField(
            key: const Key('password'),
            controller: _password,
            label: 'Mot de passe',
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: busy ? null : _login,
            child: const Text('Se connecter'),
          ),
          errorText(),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => _open(
              ForgotPasswordScreen(
                session: widget.session,
                initialIdentifier: _identifier.text.trim(),
              ),
            ),
            child: const Text('Mot de passe oublié ?'),
          ),
          TextButton(
            onPressed: () => _open(RegisterScreen(session: widget.session)),
            child: const Text('Pas encore de compte ? Créer un compte'),
          ),
        ],
      ),
    );
  }
}
