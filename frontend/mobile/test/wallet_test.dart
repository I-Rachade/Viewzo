import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/screens/wallet_screen.dart';

http.Response json(Object body, [int status = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), status);

Map<String, dynamic> summary({required int available, bool open = true}) => {
  'currency': 'XOF',
  'available': available,
  'held': 2500,
  'escrow': 0,
  'pendingWithdrawals': 0,
  'minWithdrawal': 1000,
  'withdrawalsOpen': open,
  'provider': 'cinetpay',
  'operators': <String>[],
};

void main() {
  testWidgets('shows balances and requests a withdrawal', (tester) async {
    var available = 10000;
    Object? requested;
    final client = MockClient((request) async {
      switch (request.url.path) {
        case '/me/wallet':
          return json(summary(available: available));
        case '/me/wallet/transactions':
          return json([
            {
              'id': '1',
              'type': 'EARNING',
              'amount': 2500,
              'currency': 'XOF',
              'status': 'COMPLETED',
              'availableAt': '2099-01-01T00:00:00.000Z',
              'campaignId': 'c1',
              'note': '5555 vues validées',
              'createdAt': '2026-10-19T10:00:00.000Z',
            },
          ]);
        case '/me/wallet/withdrawals':
          requested = jsonDecode(request.body);
          available -= 4000;
          return json({
            'reference': 'VZRAB',
            'amount': 4000,
            'status': 'REQUESTED',
            'checkoutUrl': null,
            'failureReason': null,
          }, 201);
      }
      return http.Response('', 404);
    });

    await tester.pumpWidget(
      MaterialApp(
        home: WalletScreen(api: ApiClient(client: client)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('10 000 FCFA'), findsOneWidget);
    expect(find.text('En attente : 2 500 FCFA'), findsOneWidget);
    expect(find.text('Gain'), findsOneWidget);
    expect(find.textContaining('disponible le 01/01/2099'), findsOneWidget);

    await tester.tap(find.text('Retirer'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), '20000');
    await tester.enterText(find.byType(TextField).at(1), 'Ama Mensah');
    await tester.tap(find.text('Demander le retrait'));
    await tester.pumpAndSettle();
    expect(find.text('Entre 1 000 FCFA et 10 000 FCFA'), findsOneWidget);

    await tester.enterText(find.byType(TextField).at(0), '4000');
    await tester.tap(find.text('Demander le retrait'));
    await tester.pumpAndSettle();

    expect(requested, {'amount': 4000, 'beneficiaryName': 'Ama Mensah'});
    expect(find.text('6 000 FCFA'), findsOneWidget);
  });

  testWidgets('keeps withdrawals closed below level 2', (tester) async {
    final client = MockClient((request) async {
      if (request.url.path == '/me/wallet') {
        return json(summary(available: 0, open: false));
      }
      return json(<Object>[]);
    });
    await tester.pumpWidget(
      MaterialApp(
        home: WalletScreen(api: ApiClient(client: client)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('s’ouvrent au niveau 2'), findsOneWidget);
    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Retirer'),
    );
    expect(button.onPressed, isNull);
  });
}
