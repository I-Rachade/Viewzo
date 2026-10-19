import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:viewzo/main.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/session.dart';

void main() {
  testWidgets('logs in with an SMS code and shows the priority rank', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final client = MockClient((request) async {
      switch (request.url.path) {
        case '/auth/otp/request':
          return http.Response(jsonEncode({'phone': '+22890123456'}), 200);
        case '/auth/otp/verify':
          expect(jsonDecode(request.body)['code'], '123456');
          return http.Response(
            jsonEncode({
              'accessToken': 'token',
              'isNew': true,
              'user': {
                'phone': '+22890123456',
                'country': 'TG',
                'priorityRank': 237,
                'isFounder': true,
                'profiles': [],
              },
            }),
            200,
          );
      }
      return http.Response('{}', 404);
    });
    final session = Session(ApiClient(client: client, baseUrl: 'http://test'));

    await tester.pumpWidget(ViewzoApp(session: session, loggedIn: false));
    await tester.enterText(find.byKey(const Key('phone')), '90123456');
    await tester.tap(find.text('Recevoir un code'));
    await tester.pumpAndSettle();

    expect(find.text('Code envoyé au +22890123456.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('code')), '123456');
    await tester.tap(find.text('Valider'));
    await tester.pumpAndSettle();

    expect(find.text('Tu es inscrit n° 237 (TG)'), findsOneWidget);
    expect(find.text('Badge Fondateur'), findsOneWidget);
    expect(session.api.token, 'token');
  });
}
