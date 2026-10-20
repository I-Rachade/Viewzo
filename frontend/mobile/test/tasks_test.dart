import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image_picker/image_picker.dart';
import 'package:viewzo/main.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/screens/tasks_screen.dart';

Map<String, dynamic> task(String id) => {
  'id': id,
  'network': 'TIKTOK',
  'contentType': 'PROVIDED_ASSETS',
  'creatorRatePer1000': 450,
  'campaign': {
    'title': 'Lancement jus Bissap',
    'hashtag': '#VZ1234',
    'endsAt': '2026-11-02T23:59:59.000Z',
    'assetUrls': ['https://example.com/video.mp4'],
    'faceRequired': false,
    'language': 'Français',
    'minDurationSec': null,
    'maxDurationSec': 30,
    'tone': null,
    'mandatoryElements': ['Logo à la fin'],
    'forbiddenElements': <String>[],
    'examples': <String>[],
  },
};

http.Response json(Object body, [int status = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), status);

void main() {
  testWidgets('shows tasks without an eligible account as locked', (
    tester,
  ) async {
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path == '/me/tasks') {
        return json([
          {...task('t1'), 'network': 'INSTAGRAM', 'locked': true},
        ]);
      }
      if (path == '/me/assignments') return json([]);
      return http.Response('', 404);
    });

    await tester.pumpWidget(
      VzApp(
        home: TasksScreen(api: ApiClient(client: client)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Bloquée'), findsOneWidget);
    expect(
      find.text(
        'Ajoute un compte Instagram vérifié dans Mes comptes '
        'pour accepter cette tâche.',
      ),
      findsOneWidget,
    );
    expect(find.text('Accepter'), findsNothing);
  });

  testWidgets('accepts a task and submits the post link', (tester) async {
    final available = [task('t1')];
    final assignments = <Map<String, dynamic>>[];
    Object? submitted;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path == '/me/tasks') return json(available);
      if (path == '/me/assignments') return json(assignments);
      if (path == '/tasks/t1/accept') {
        available.clear();
        assignments.add({
          'id': 'a1',
          'status': 'ACCEPTED',
          'postUrl': null,
          'task': task('t1'),
        });
        return json(assignments.last, 201);
      }
      if (path == '/me/assignments/a1/submit') {
        submitted = jsonDecode(request.body);
        assignments[0] = {
          ...assignments[0],
          'status': 'SUBMITTED',
          'postUrl': (submitted as Map)['postUrl'],
        };
        return json(assignments[0]);
      }
      return http.Response('', 404);
    });

    await tester.pumpWidget(
      VzApp(
        home: TasksScreen(api: ApiClient(client: client)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Lancement jus Bissap'), findsOneWidget);
    expect(find.textContaining('450 FCFA pour 1 000 vues'), findsOneWidget);
    expect(find.textContaining('#VZ1234'), findsOneWidget);
    expect(find.textContaining('au plus 30 s'), findsOneWidget);

    await tester.tap(find.text('Accepter'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(
      find.text('Tâche acceptée, retrouve-la dans Mes tâches'),
      findsOneWidget,
    );
    await tester.pumpAndSettle();
    expect(find.text('Accepter'), findsNothing);
    expect(
      find.text('Tâche acceptée, retrouve-la dans Mes tâches'),
      findsNothing,
    );

    await tester.tap(find.text('Mes tâches'));
    await tester.pumpAndSettle();
    expect(find.text('À publier'), findsOneWidget);

    await tester.tap(find.text('J’ai publié'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(EditableText), 'pas un lien');
    await tester.tap(find.text('Envoyer'));
    await tester.pumpAndSettle();
    expect(find.textContaining('commençant par https://'), findsOneWidget);

    await tester.enterText(
      find.byType(EditableText),
      'https://www.tiktok.com/@ama/video/1',
    );
    await tester.tap(find.text('Envoyer'));
    await tester.pumpAndSettle();

    expect(submitted, {'postUrl': 'https://www.tiktok.com/@ama/video/1'});
    expect(find.text('En vérification'), findsOneWidget);
    expect(find.text('Ajouter une capture'), findsOneWidget);
  });

  testWidgets('filters the tasks by network', (tester) async {
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path == '/me/tasks') {
        return json([
          task('t1'),
          {
            ...task('t2'),
            'network': 'INSTAGRAM',
            'campaign': {
              ...(task('t2')['campaign'] as Map),
              'title': 'Promo boutique Lomé',
            },
          },
        ]);
      }
      if (path == '/me/assignments') return json([]);
      return http.Response('', 404);
    });

    await tester.pumpWidget(
      VzApp(
        home: TasksScreen(api: ApiClient(client: client)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Lancement jus Bissap'), findsOneWidget);
    expect(find.text('Promo boutique Lomé'), findsOneWidget);

    await tester.tap(find.text('Instagram').first);
    await tester.pumpAndSettle();
    expect(find.text('Lancement jus Bissap'), findsNothing);
    expect(find.text('Promo boutique Lomé'), findsOneWidget);

    await tester.tap(find.text('Tous'));
    await tester.pumpAndSettle();
    expect(find.text('Lancement jus Bissap'), findsOneWidget);
  });

  testWidgets('sends WhatsApp Statut screenshots and shows the results', (
    tester,
  ) async {
    var assignment = <String, dynamic>{
      'id': 'a1',
      'status': 'SUBMITTED',
      'postUrl': null,
      'reviewStatus': 'NEEDS_FIX',
      'reviewReason': 'Le hashtag n’est pas visible',
      'validViews': 0,
      'earned': 0,
      'declaredViews': null,
      'proofs': <Object>[],
      'proofPlan': {
        'steps': [
          {'label': 'Au départ', 'dueAt': null, 'doneAt': null},
          {'label': 'Après 12 h', 'dueAt': null, 'doneAt': null},
          {'label': 'Avant 24 h', 'dueAt': null, 'doneAt': null},
        ],
        'nextDueAt': '2026-10-20T08:00:00.000Z',
      },
      'task': {...task('t1'), 'network': 'WHATSAPP_STATUS'},
    };
    http.MultipartRequest? upload;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path == '/me/tasks') return json([]);
      if (path == '/me/assignments') return json([assignment]);
      if (path == '/me/results') {
        return json({
          'validViews': 12500,
          'earned': 5000,
          'earnedThisMonth': 2000,
          'toReview': 0,
          'needsFix': 1,
          'validated': 3,
          'rejected': 1,
          'validationRate': 75,
        });
      }
      return http.Response('', 404);
    });
    // MockClient reads multipart bodies as plain requests; catch the upload.
    final api = _UploadSpy(client, (r) {
      upload = r;
      assignment = {
        ...assignment,
        'status': 'SUBMITTED',
        'reviewStatus': 'TO_REVIEW',
        'reviewReason': null,
        'declaredViews': 340,
        'proofs': [
          {'kind': 'SCREENSHOT'},
        ],
        'proofPlan': {
          'steps': [
            {
              'label': 'Au départ',
              'dueAt': '2026-10-20T08:00:00.000Z',
              'doneAt': '2026-10-20T08:00:00.000Z',
            },
            {
              'label': 'Après 12 h',
              'dueAt': '2026-10-20T20:00:00.000Z',
              'doneAt': null,
            },
            {
              'label': 'Avant 24 h',
              'dueAt': '2026-10-21T07:00:00.000Z',
              'doneAt': null,
            },
          ],
          'nextDueAt': '2026-10-20T20:00:00.000Z',
        },
      };
    });

    await tester.pumpWidget(
      VzApp(
        home: TasksScreen(
          api: api,
          pickImage: () async => XFile.fromData(
            Uint8List.fromList([137, 80, 78, 71]),
            path: 'statut.png',
            lastModified: DateTime.utc(2026, 10, 20, 8),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mes tâches'));
    await tester.pumpAndSettle();

    expect(find.text('Mes résultats'), findsOneWidget);
    expect(find.text('75 %'), findsOneWidget);
    expect(find.text('À corriger'), findsOneWidget);
    expect(find.text('Le hashtag n’est pas visible'), findsOneWidget);
    expect(find.textContaining('Au départ'), findsOneWidget);

    await tester.ensureVisible(find.text('Envoyer une capture'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Envoyer une capture'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(EditableText), '340');
    await tester.tap(find.text('Envoyer'));
    await tester.pumpAndSettle();

    expect(upload!.url.path, '/me/assignments/a1/proofs');
    expect(upload!.fields['declaredViews'], '340');
    expect(upload!.files.single.filename, 'statut.png');
    expect(upload!.fields['capturedAt'], '2026-10-20T08:00:00.000Z');
    expect(upload!.headers['X-Device-Id'], 'phone-1');
    expect(find.text('En vérification'), findsOneWidget);
    expect(find.textContaining('340 déclarées'), findsOneWidget);
    expect(find.textContaining('Au départ · envoyée'), findsOneWidget);
    expect(find.textContaining('Après 12 h · à envoyer vers'), findsOneWidget);
  });
}

/// Records the screenshot upload and answers it, other calls go to [client].
class _UploadSpy extends ApiClient {
  _UploadSpy(http.Client client, this.onUpload)
    : super(client: _Spy(client, onUpload)) {
    deviceId = 'phone-1';
  }
  final void Function(http.MultipartRequest) onUpload;
}

class _Spy extends http.BaseClient {
  _Spy(this.inner, this.onUpload);
  final http.Client inner;
  final void Function(http.MultipartRequest) onUpload;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request is http.MultipartRequest) {
      onUpload(request);
      return http.StreamedResponse(
        Stream.value(utf8.encode('{"ok":true}')),
        201,
      );
    }
    return inner.send(request);
  }
}
