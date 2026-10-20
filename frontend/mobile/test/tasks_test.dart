import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
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
      MaterialApp(
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
    await tester.enterText(find.byType(TextField), 'pas un lien');
    await tester.tap(find.text('Envoyer'));
    await tester.pumpAndSettle();
    expect(find.textContaining('commençant par https://'), findsOneWidget);

    await tester.enterText(
      find.byType(TextField),
      'https://www.tiktok.com/@ama/video/1',
    );
    await tester.tap(find.text('Envoyer'));
    await tester.pumpAndSettle();

    expect(submitted, {'postUrl': 'https://www.tiktok.com/@ama/video/1'});
    expect(find.text('Lien envoyé'), findsOneWidget);
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
      MaterialApp(
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
}
