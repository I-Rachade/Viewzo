import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:viewzo/main.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/session.dart';

void main() {
  testWidgets('opens on the animated mark, then the login screen', (
    tester,
  ) async {
    final client = MockClient((_) async => http.Response('{}', 404));
    final session = Session(ApiClient(client: client, baseUrl: 'http://test'));

    await tester.pumpWidget(ViewzoApp(session: session, loggedIn: false));
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.text('Tes vues, payées. Partout dans le monde.'), findsOne);

    await tester.pumpAndSettle();
    expect(find.text('Tes vues, payées. Partout dans le monde.'), findsNothing);
    expect(find.byKey(const Key('phone')), findsOneWidget);
  });
}
