import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../session.dart';
import '../ui/widgets.dart';
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
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        children: [
          // The brand on top: the mark and a short welcome.
          FadeSlideIn(
            child: Column(
              spacing: 16,
              children: [
                VzMark(size: 56, outline: VzMark.outlineFor(context)),
                Text(
                  'Content de te revoir',
                  textAlign: TextAlign.center,
                  style: ShadTheme.of(context).textTheme.h3
                      .copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          FadeSlideIn(
            child: IdentifierInput(
              kind: _kind,
              controller: _identifier,
              onKindChanged: (kind) => setState(() {
                _kind = kind;
                _identifier.clear();
              }),
            ),
          ),
          const SizedBox(height: 16),
          FadeSlideIn(
            index: 1,
            child: PasswordField(
              key: const Key('password'),
              controller: _password,
              label: 'Mot de passe',
            ),
          ),
          const SizedBox(height: 28),
          FadeSlideIn(
            index: 2,
            child: Pressable(
              child: ShadButton(
                size: ShadButtonSize.lg,
                width: double.infinity,
                enabled: !busy,
                onPressed: busy ? null : _login,
                child: const Flexible(
                  child: Text('Se connecter', overflow: TextOverflow.ellipsis),
                ),
              ),
            ),
          ),
          errorText(),
          const SizedBox(height: 12),
          ShadButton.ghost(
            width: double.infinity,
            onPressed: () => _open(
              ForgotPasswordScreen(
                session: widget.session,
                initialIdentifier: _identifier.text.trim(),
              ),
            ),
            child: const Flexible(
              child: Text(
                'Mot de passe oublié ?',
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          ShadButton.link(
            width: double.infinity,
            onPressed: () => _open(RegisterScreen(session: widget.session)),
            child: const Flexible(
              child: Text(
                'Pas encore de compte ? Créer un compte',
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
