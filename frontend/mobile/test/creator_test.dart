import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/screens/accounts_screen.dart';
import 'package:viewzo/src/screens/skills_screen.dart';

Map<String, dynamic> account(
  String id,
  String network,
  String status, {
  String? reason,
  Map<String, dynamic>? verification,
}) => {
  'id': id,
  'network': network,
  'handle': '@ama',
  'status': status,
  'statusReason': reason,
  'retryAfter': null,
  'reviewDueAt': status == 'PENDING' ? '2026-10-21T10:00:00.000Z' : null,
  'verification': verification,
};

void main() {
  testWidgets('shows each account status and adds a network', (tester) async {
    final accounts = [
      account('1', 'TIKTOK', 'ELIGIBLE'),
      account(
        '2',
        'INSTAGRAM',
        'NEEDS_FIX',
        reason: 'Code absent de la bio',
        verification: {'kind': 'BIO_CODE', 'code': 'VZ-123456'},
      ),
    ];
    Object? added;
    final client = MockClient((request) async {
      if (request.url.path == '/me/accounts' && request.method == 'POST') {
        added = jsonDecode(request.body);
        accounts.add(
          account(
            '3',
            'WHATSAPP_STATUS',
            'PENDING',
            verification: {
              'kind': 'WHATSAPP',
              'code': 'VZ-654321',
              'contactNumber': '+22890000000',
              'messageText': 'Bonjour Viewzo',
              'whatsappLink': 'https://wa.me/22890000000',
            },
          ),
        );
        return http.Response(jsonEncode(accounts.last), 201);
      }
      if (request.url.path == '/me/accounts') {
        return http.Response(jsonEncode(accounts), 200);
      }
      return http.Response('{}', 404);
    });
    final api = ApiClient(client: client, baseUrl: 'http://test');

    await tester.pumpWidget(
      MaterialApp(
        home: AccountsScreen(api: api, phone: '+22890123456'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Éligible'), findsOneWidget);
    expect(find.text('À corriger'), findsOneWidget);
    expect(find.text('À faire : Code absent de la bio'), findsOneWidget);
    expect(find.text('VZ-123456'), findsOneWidget);
    expect(find.text('Relancer la vérification'), findsOneWidget);

    await tester.tap(find.text('Ajouter un réseau'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('network')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('WhatsApp Statut').last);
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('handle')))
          .controller!
          .text,
      '+22890123456',
    );
    await tester.tap(find.text('Ajouter'));
    await tester.pumpAndSettle();

    expect(added, {'network': 'WHATSAPP_STATUS', 'handle': '+22890123456'});
    expect(find.text('En vérification'), findsOneWidget);
    expect(find.text('Envoyer sur WhatsApp'), findsOneWidget);
  });

  testWidgets('saves the skills form', (tester) async {
    Map<String, dynamic>? saved;
    final client = MockClient((request) async {
      if (request.method == 'PUT') {
        saved = jsonDecode(request.body) as Map<String, dynamic>;
        // Like the server, answer in UTF-8.
        return http.Response.bytes(utf8.encode(jsonEncode(saved)), 200);
      }
      return http.Response('', 200);
    });
    final api = ApiClient(client: client, baseUrl: 'http://test');

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => SkillsScreen(api: api, country: 'TG'),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Publier des vidéos fournies'));
    final form = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.text('Food'), 200, scrollable: form);
    await tester.tap(find.text('Food'));
    await tester.pump();
    await tester.scrollUntilVisible(
      find.text('Enregistrer'),
      200,
      scrollable: form,
    );
    await tester.tap(find.text('Enregistrer'));
    await tester.pumpAndSettle();

    expect(saved, isNotNull);
    expect(saved!['taskTypes'], ['POST_PROVIDED_VIDEO']);
    expect(saved!['themes'], ['Food']);
    expect(saved!['countries'], ['TG']);
    expect(saved!['languages'], ['Français']);
    // Back on the previous screen once saved.
    expect(find.byType(SkillsScreen), findsNothing);
  });
}
