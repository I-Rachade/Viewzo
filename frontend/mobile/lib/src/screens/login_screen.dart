import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session});
  final Session session;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String? _sentTo;
  String? _error;
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Serveur injoignable');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _requestCode() => _run(() async {
    final sentTo = await widget.session.api.requestCode(_phone.text);
    setState(() => _sentTo = sentTo);
  });

  Future<void> _verifyCode() => _run(() async {
    final user = await widget.session.api.verifyCode(_phone.text, _code.text);
    await widget.session.save();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => HomeScreen(session: widget.session, initialUser: user),
      ),
    );
  });

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connexion')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          if (_sentTo == null) ...[
            TextField(
              key: const Key('phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(
                labelText: 'Numéro de téléphone',
                hintText: '+228 90 12 34 56',
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _requestCode,
              child: const Text('Recevoir un code'),
            ),
          ] else ...[
            Text('Code envoyé au $_sentTo.'),
            const SizedBox(height: 16),
            TextField(
              key: const Key('code'),
              controller: _code,
              keyboardType: TextInputType.number,
              maxLength: 6,
              autofillHints: const [AutofillHints.oneTimeCode],
              decoration: const InputDecoration(labelText: 'Code à 6 chiffres'),
            ),
            FilledButton(
              onPressed: _busy ? null : _verifyCode,
              child: const Text('Valider'),
            ),
            TextButton(
              onPressed: () => setState(() => _sentTo = null),
              child: const Text('Changer de numéro'),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
    );
  }
}
