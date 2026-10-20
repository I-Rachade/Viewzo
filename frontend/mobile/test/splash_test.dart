import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:viewzo/main.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/screens/splash_screen.dart';
import 'package:viewzo/src/session.dart';

import 'memory_store.dart';

void main() {
  testWidgets('opens on the animated welcome, then the login screen', (
    tester,
  ) async {
    final client = MockClient((_) async => http.Response('{}', 404));
    final session = Session(
      ApiClient(client: client, baseUrl: 'http://test'),
      store: MemoryStore(),
    );

    await tester.pumpWidget(ViewzoApp(session: session, loggedIn: false));
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.text('Viewzo'), findsOne);
    expect(find.text('Ton audience vaut de l’argent.'), findsOne);

    await tester.pumpAndSettle();
    expect(find.text('+12 vues'), findsOne);
    expect(find.text('+60 F'), findsOne);
    expect(find.text('Tes vues, payées. Partout dans le monde.'), findsOne);

    await tester.tap(find.text('Commencer à gagner'));
    await tester.pumpAndSettle();
    expect(find.text('Commencer à gagner'), findsNothing);
    expect(find.byKey(const Key('identifier')), findsOneWidget);
  });

  testWidgets('goes straight on when already signed in', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SplashScreen(next: Text('Accueil'), waitForStart: false),
      ),
    );
    expect(find.text('Commencer à gagner'), findsNothing);
    await tester.pumpAndSettle();
    expect(find.text('Accueil'), findsOne);
  });
}
