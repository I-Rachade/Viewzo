import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../identity_models.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Level 2: an ID document and a selfie, checked on the provider's page in
/// the browser, then by the team when the provider can't decide alone.
class IdentityScreen extends StatefulWidget {
  const IdentityScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<IdentityScreen> createState() => _IdentityScreenState();
}

class _IdentityScreenState extends State<IdentityScreen>
    with WidgetsBindingObserver {
  IdentityStatus? _status;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Back from the provider's page in the browser: ask for the result.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _status?.check?.status == 'STARTED') {
      _refresh();
    }
  }

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

  Future<void> _load() => _run(() async {
    final status = await widget.api.identity();
    if (mounted) setState(() => _status = status);
  });

  Future<void> _start() => _run(() async {
    final check = await widget.api.startIdentity();
    final url = check.url;
    if (url != null) {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    }
    final status = await widget.api.identity();
    if (mounted) setState(() => _status = status);
  });

  Future<void> _refresh() => _run(() async {
    await widget.api.refreshIdentity();
    final status = await widget.api.identity();
    if (mounted) setState(() => _status = status);
  });

  @override
  Widget build(BuildContext context) {
    final status = _status;
    final theme = ShadTheme.of(context);
    final check = status?.check;
    return Scaffold(
      appBar: AppBar(title: const Text('Mon identité')),
      body: status == null && _error == null
          ? const SkeletonList()
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  if (status != null && status.verified) ...[
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Pill('Identité vérifiée', tone: PillTone.paid),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      '${check?.fullName != null ? 'Au nom de ${check!.fullName}. ' : ''}'
                      'Tes profils créateur et annonceur sont au niveau 2 : '
                      'toutes les tâches et les retraits sont ouverts.',
                      style: theme.textTheme.p.copyWith(height: 1.45),
                    ),
                  ] else ...[
                    Text(
                      'Le niveau 2 ouvre toutes les tâches et les retraits. '
                      'Il te faut ta pièce d’identité (carte, passeport ou '
                      'permis) et un selfie. Compte 3 minutes.',
                      style: theme.textTheme.p.copyWith(height: 1.45),
                    ),
                    const SizedBox(height: 12),
                    const ShadAlert(
                      icon: Icon(LucideIcons.lightbulb),
                      description: Text(
                        'Pièce valide, en entier et sans reflet. Selfie bien '
                        'éclairé, sans lunettes ni casquette. Pour tes '
                        'retraits, le compte Mobile Money doit être à ton nom.',
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (check != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          'Dernière demande : '
                          '${identityStatusLabels[check.status] ?? check.status}'
                          '${check.reason != null ? ' · ${check.reason}' : ''}',
                          style: theme.textTheme.muted,
                        ),
                      ),
                    if (status != null) ..._actions(status, theme),
                  ],
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: ShadAlert.destructive(
                        icon: const Icon(LucideIcons.circleAlert),
                        title: Text(_error!),
                      ),
                    ),
                ],
              ),
            ),
    );
  }

  List<Widget> _actions(IdentityStatus status, ShadThemeData theme) {
    final check = status.check;
    if (!status.available) {
      return [
        Text(
          'La vérification d’identité ouvre bientôt.',
          style: theme.textTheme.muted,
        ),
      ];
    }
    if (status.needsProfile) {
      return [
        Text(
          'Active d’abord ton profil créateur ou annonceur.',
          style: theme.textTheme.muted,
        ),
      ];
    }
    if (check?.status == 'IN_REVIEW') {
      return [
        const ShadAlert(
          icon: Icon(LucideIcons.hourglass),
          title: Text('En examen'),
          description: Text(
            'L’équipe Viewzo examine ton dossier, en général sous 48 h. '
            'Tu recevras une notification.',
          ),
        ),
      ];
    }
    final retryAfter = status.retryAfter;
    if (retryAfter != null) {
      return [
        ShadAlert.destructive(
          icon: const Icon(LucideIcons.clock),
          title: Text(
            'Trop d’essais refusés : réessaie à partir du '
            '${retryAfter.day}/${retryAfter.month}/${retryAfter.year}.',
          ),
        ),
      ];
    }
    final started = check?.status == 'STARTED';
    return [
      ShadButton(
        width: double.infinity,
        enabled: !_busy,
        onPressed: _start,
        backgroundColor: VzColors.coral,
        child: Text(
          started ? 'Reprendre la vérification' : 'Commencer la vérification',
        ),
      ),
      if (started) ...[
        const SizedBox(height: 8),
        ShadButton.outline(
          width: double.infinity,
          enabled: !_busy,
          onPressed: _refresh,
          child: const Text('J’ai terminé'),
        ),
      ],
    ];
  }
}
