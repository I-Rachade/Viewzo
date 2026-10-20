import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:viewzo/main.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/screens/notifications_screen.dart';

http.Response json(Object body, [int status = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), status);

void main() {
  testWidgets('lists notifications, marks them read and opens their screen', (
    tester,
  ) async {
    var markedRead = false;
    String? opened;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path == '/me/notifications') {
        return json({
          'unread': 1,
          'items': [
            {
              'id': 'n1',
              'type': 'POST_NEEDS_FIX',
              'title': 'Publication à corriger',
              'body': 'Le hashtag n’est pas visible',
              'link': '/resultats',
              'readAt': null,
              'createdAt': '2026-10-20T08:00:00.000Z',
            },
          ],
        });
      }
      if (path == '/me/notifications/read') {
        markedRead = true;
        return json({'unread': 0});
      }
      return http.Response('', 404);
    });

    await tester.pumpWidget(
      VzApp(
        home: NotificationsScreen(
          api: ApiClient(client: client),
          onOpen: (link) => opened = link,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Publication à corriger'), findsOneWidget);
    expect(find.textContaining('Le hashtag n’est pas visible'), findsOneWidget);
    expect(markedRead, isTrue);

    await tester.tap(find.text('Publication à corriger'));
    expect(opened, '/resultats');
  });
}
