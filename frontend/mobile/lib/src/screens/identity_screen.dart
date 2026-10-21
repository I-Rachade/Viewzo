import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../identity_models.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// The three photos of a verification.
enum IdentityPhoto { front, back, selfie }

/// Level 2: photos of the ID document and a selfie, checked at once, then by
/// the team when the check can't decide alone.
class IdentityScreen extends StatefulWidget {
  const IdentityScreen({super.key, required this.api, this.pickImage});
  final ApiClient api;
  // Replaces the camera in tests.
  final Future<XFile?> Function(IdentityPhoto photo)? pickImage;

  @override
  State<IdentityScreen> createState() => _IdentityScreenState();
}

class _IdentityScreenState extends State<IdentityScreen> {
  IdentityStatus? _status;
  String? _error;
  bool _busy = false;
  final Map<IdentityPhoto, Uint8List> _photos = {};

  @override
  void initState() {
    super.initState();
    _load();
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

  Future<void> _pick(IdentityPhoto photo) async {
    final pick =
        widget.pickImage ??
        (IdentityPhoto photo) => ImagePicker().pickImage(
          source: ImageSource.camera,
          preferredCameraDevice: photo == IdentityPhoto.selfie
              ? CameraDevice.front
              : CameraDevice.rear,
          // Small enough to go through on a mobile connection.
          maxWidth: 1600,
          maxHeight: 1600,
          imageQuality: 85,
        );
    final file = await pick(photo);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (mounted) setState(() => _photos[photo] = bytes);
  }

  Future<void> _submit() => _run(() async {
    await widget.api.submitIdentity(
      front: _photos[IdentityPhoto.front]!,
      back: _photos[IdentityPhoto.back],
      selfie: _photos[IdentityPhoto.selfie]!,
    );
    final status = await widget.api.identity();
    if (mounted) {
      setState(() {
        _photos.clear();
        _status = status;
      });
    }
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
                      'Prends en photo ta pièce d’identité (carte, passeport '
                      'ou permis), puis fais un selfie. La réponse arrive en '
                      'quelques secondes.',
                      style: theme.textTheme.p.copyWith(height: 1.45),
                    ),
                    const SizedBox(height: 12),
                    const ShadAlert(
                      icon: Icon(LucideIcons.lightbulb),
                      description: Text(
                        'Pièce valide, en entier et sans reflet. Selfie bien '
                        'éclairé, sans lunettes ni casquette. Pour tes '
                        'retraits, le compte Mobile Money doit être à ton nom. '
                        'Viewzo ne garde pas tes photos.',
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
    final ready =
        _photos.containsKey(IdentityPhoto.front) &&
        _photos.containsKey(IdentityPhoto.selfie);
    return [
      _slot(
        IdentityPhoto.front,
        '1. Recto de la pièce',
        'La pièce en entier, à plat, sans reflet.',
        theme,
      ),
      _slot(
        IdentityPhoto.back,
        '2. Verso de la pièce',
        'Facultatif pour un passeport.',
        theme,
      ),
      _slot(
        IdentityPhoto.selfie,
        '3. Selfie',
        'Ton visage de face, bien éclairé.',
        theme,
      ),
      const SizedBox(height: 8),
      ShadButton(
        width: double.infinity,
        enabled: !_busy && ready,
        onPressed: _submit,
        backgroundColor: VzColors.coral,
        child: Text(
          _busy ? 'Vérification en cours…' : 'Envoyer pour vérification',
        ),
      ),
    ];
  }

  Widget _slot(
    IdentityPhoto photo,
    String title,
    String hint,
    ShadThemeData theme,
  ) {
    final bytes = _photos[photo];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: ShadCard(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 64,
                height: 64,
                child: bytes == null
                    ? ColoredBox(
                        color: theme.colorScheme.muted,
                        child: Icon(
                          photo == IdentityPhoto.selfie
                              ? LucideIcons.user
                              : LucideIcons.idCard,
                          color: theme.colorScheme.mutedForeground,
                        ),
                      )
                    : Image.memory(
                        bytes,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) =>
                            const Icon(LucideIcons.imageOff),
                      ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: theme.textTheme.p),
                  Text(hint, style: theme.textTheme.muted),
                ],
              ),
            ),
            ShadButton.outline(
              size: ShadButtonSize.sm,
              enabled: !_busy,
              onPressed: () => _pick(photo),
              child: Text(bytes == null ? 'Photo' : 'Refaire'),
            ),
          ],
        ),
      ),
    );
  }
}
