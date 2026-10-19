import 'dart:async';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';
import 'home_screen.dart';

// SMS can take a few minutes to arrive, and every new code cancels the
// previous one, so asking again too early locks people out.
const resendDelay = Duration(minutes: 2);

String _formatWait(Duration d) {
  final s = (d.inMilliseconds / 1000).ceil();
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

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
  String? _sentInput;
  DateTime? _sentAt;
  bool _enteringCode = false;
  Timer? _ticker;
  String? _error;
  bool _busy = false;

  Duration get _wait {
    if (_sentAt == null) return Duration.zero;
    final left = _sentAt!.add(resendDelay).difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }

  bool get _waiting => _wait > Duration.zero;

  // Only the number that just got a code has to wait; a corrected number can
  // ask right away.
  bool get _phoneLocked => _waiting && _sentInput == _phone.text.trim();

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
    setState(() {
      _sentTo = sentTo;
      _sentInput = _phone.text.trim();
      _sentAt = DateTime.now();
      _enteringCode = true;
    });
    _code.clear();
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!_waiting) t.cancel();
      setState(() {});
    });
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
    _ticker?.cancel();
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
          if (!_enteringCode || _sentTo == null) ...[
            TextField(
              key: const Key('phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(
                labelText: 'Numéro de téléphone',
                hintText: '+228 90 12 34 56',
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy || _phoneLocked ? null : _requestCode,
              child: Text(
                _phoneLocked
                    ? 'Nouveau code dans ${_formatWait(_wait)}'
                    : 'Recevoir un code',
              ),
            ),
            if (_phoneLocked)
              TextButton(
                onPressed: () => setState(() => _enteringCode = true),
                child: const Text("J'ai déjà un code"),
              ),
          ] else ...[
            Text('Code envoyé au $_sentTo.'),
            const SizedBox(height: 8),
            Text(
              'Le SMS peut mettre quelques minutes à arriver. '
              'Chaque nouveau code annule le précédent.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
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
              onPressed: _busy || _waiting ? null : _requestCode,
              child: Text(
                _waiting
                    ? 'Renvoyer le code dans ${_formatWait(_wait)}'
                    : 'Renvoyer le code',
              ),
            ),
            TextButton(
              onPressed: () => setState(() => _enteringCode = false),
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
