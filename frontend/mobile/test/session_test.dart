import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/session.dart';

import 'memory_store.dart';

http.Response json(Object body, [int status = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), status);

const user = {
  'phone': '+22890000001',
  'email': null,
  'hasPassword': true,
  'country': 'TG',
  'priorityRank': 1,
  'isFounder': true,
  'profiles': [],
};

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('renews an expired access token and sends the request again', () async {
    final seen = <String>[];
    final api = ApiClient(
      baseUrl: 'http://test',
      client: MockClient((request) async {
        seen.add('${request.url.path} ${request.headers['Authorization']}');
        if (request.url.path == '/auth/refresh') {
          expect(jsonDecode(request.body), {'refreshToken': 'refresh-1'});
          return json({'accessToken': 'new', 'refreshToken': 'refresh-2'});
        }
        return request.headers['Authorization'] == 'Bearer new'
            ? json(user)
            : json({'message': 'Unauthorized'}, 401);
      }),
    );
    final session = Session(api, store: MemoryStore());
    api
      ..token = 'old'
      ..refreshToken = 'refresh-1';

    final me = await api.me();

    expect(me.priorityRank, 1);
    expect(seen, ['/me Bearer old', '/auth/refresh null', '/me Bearer new']);
    // The new pair is saved at once.
    final store = session.store as MemoryStore;
    expect(store.values['viewzo.refresh'], 'refresh-2');
  });

  test('ends the session when the refresh token is refused', () async {
    final api = ApiClient(
      baseUrl: 'http://test',
      client: MockClient((request) async {
        if (request.url.path == '/auth/refresh') {
          return json({'message': 'Session expirée'}, 401);
        }
        return json({'message': 'Unauthorized'}, 401);
      }),
    );
    final store = MemoryStore()..values['viewzo.refresh'] = 'refresh-1';
    Session(api, store: store);
    api
      ..token = 'old'
      ..refreshToken = 'refresh-1';

    await expectLater(
      api.me(),
      throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)),
    );
    expect(api.refreshToken, isNull);
    expect(store.values, isEmpty);
  });

  test('keeps the session when the network is down', () async {
    final api = ApiClient(
      baseUrl: 'http://test',
      client: MockClient((_) async => throw http.ClientException('offline')),
    );
    Session(api, store: MemoryStore());
    api
      ..token = 'old'
      ..refreshToken = 'refresh-1';

    await expectLater(api.me(), throwsA(isA<http.ClientException>()));
    expect(api.refreshToken, 'refresh-1');
  });

  test('signs out on the server and restores nothing afterwards', () async {
    String? loggedOut;
    final api = ApiClient(
      baseUrl: 'http://test',
      client: MockClient((request) async {
        if (request.url.path == '/auth/logout') {
          loggedOut = jsonDecode(request.body)['refreshToken'] as String;
          return http.Response('', 204);
        }
        return json({}, 404);
      }),
    );
    final store = MemoryStore();
    final session = Session(api, store: store);
    api
      ..token = 'access'
      ..refreshToken = 'refresh-1';
    await session.save();
    expect(await Session(api, store: store).restore(), isTrue);

    await session.clear();

    expect(loggedOut, 'refresh-1');
    expect(await Session(api, store: store).restore(), isFalse);
  });

  test('drops the token kept in plain storage by older versions', () async {
    SharedPreferences.setMockInitialValues({'viewzo.token': 'legacy'});
    final api = ApiClient(
      baseUrl: 'http://test',
      client: MockClient((_) async => json({}, 404)),
    );

    expect(await Session(api, store: MemoryStore()).restore(), isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('viewzo.token'), isNull);
  });
}
