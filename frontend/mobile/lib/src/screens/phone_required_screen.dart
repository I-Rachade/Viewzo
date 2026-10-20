import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../ui/country_select.dart';
import '../ui/widgets.dart';
import 'auth_widgets.dart';
import 'tasks_screen.dart';

/// Shown instead of the app to a creator signed up with an e-mail: they
/// confirm a phone number of their account's country before doing anything
/// else. The campaigns can still be looked at.
class PhoneRequiredScreen extends StatefulWidget {
  const PhoneRequiredScreen({
    super.key,
    required this.api,
    required this.user,
    required this.onVerified,
    required this.onLogout,
  });
  final ApiClient api;
  final UserView user;
  final ValueChanged<UserView> onVerified;
  final VoidCallback onLogout;

  @override
  State<PhoneRequiredScreen> createState() => _PhoneRequiredScreenState();
}

class _PhoneRequiredScreenState extends State<PhoneRequiredScreen>
    with CodeFormState<PhoneRequiredScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _enteringCode = false;

  Future<void> _request() => run(() async {
    final phone = _phone.text.trim();
    final to = await widget.api.contactRequest(phone);
    codeSent(to, phone);
    _code.clear();
    setState(() => _enteringCode = true);
  });

  Future<void> _verify() => run(() async {
    final user = await widget.api.contactVerify(sentInput!, _code.text.trim());
    widget.onVerified(user);
  });

  void _campaigns() {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => TasksScreen(api: widget.api)));
  }

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final country = widget.user.country;
    final locked = lockedFor(_phone.text);
    return Scaffold(
      appBar: AppBar(title: const Text('Ton numéro')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        children: [
          FadeSlideIn(
            child: Column(
              spacing: 12,
              children: [
                VzMark(size: 56, outline: VzMark.outlineFor(context)),
                Text(
                  'Ajoute ton numéro',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.h3.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  'Pour accepter des campagnes et être payé, confirme ton '
                  'numéro de téléphone. Tu recevras un code par SMS.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.muted,
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          if (!_enteringCode) ...[
            FadeSlideIn(
              index: 1,
              child: ShadInputFormField(
                key: const Key('phone'),
                controller: _phone,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                label: const Text('Numéro de téléphone'),
                placeholder: Text(
                  country == 'TG' ? '+228 90 12 34 56' : 'Ton numéro',
                ),
                description: Text(
                  '${flagOf(country)} ${countryName(country)} : le numéro '
                  'doit être du pays de ton compte.',
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),
            const SizedBox(height: 24),
            Pressable(
              child: ShadButton(
                size: ShadButtonSize.lg,
                width: double.infinity,
                enabled: !busy && !locked,
                onPressed: busy || locked ? null : _request,
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
          ] else ...[
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
                child: const Text('Valider'),
              ),
            ),
            resendButton(_request),
            ShadButton.ghost(
              width: double.infinity,
              onPressed: () => setState(() => _enteringCode = false),
              child: const Text('Modifier le numéro'),
            ),
          ],
          errorText(),
          const SizedBox(height: 20),
          ShadButton.outline(
            width: double.infinity,
            leading: const Icon(LucideIcons.megaphone, size: 18),
            onPressed: _campaigns,
            child: const Text('Voir les campagnes'),
          ),
          ShadButton.ghost(
            width: double.infinity,
            onPressed: widget.onLogout,
            child: const Text('Se déconnecter'),
          ),
        ],
      ),
    );
  }
}
