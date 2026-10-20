import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:viewzo/main.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/screens/home_screen.dart';
import 'package:viewzo/src/session.dart';

import 'memory_store.dart';

Map<String, dynamic> userJson({
  String? email = 'ama@exemple.com',
  String? phone,
  bool phoneRequired = false,
}) => {
  'phone': phone,
  'email': email,
  'hasPassword': true,
  'phoneRequired': phoneRequired,
  'country': 'TG',
  'priorityRank': 237,
  'isFounder': true,
  'profiles': [],
};

http.Response json(Object body, [int status = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), status);

Session sessionWith(MockClientHandler handler) => Session(
  ApiClient(client: MockClient(handler), baseUrl: 'http://test'),
  store: MemoryStore(),
);

/// The Material or shadcn button that holds [text].
Finder buttonOf(String text) => find
    .ancestor(
      of: find.text(text),
      matching: find.byWidgetPredicate(
        (w) => w is ButtonStyleButton || w is ShadButton,
      ),
    )
    .first;

bool enabled(WidgetTester tester, String text) =>
    switch (tester.widget(buttonOf(text))) {
      final ShadButton b => b.enabled && b.onPressed != null,
      final ButtonStyleButton b => b.onPressed != null,
      _ => throw StateError('No button for $text'),
    };

/// Goes from the login screen to the password step of the e-mail sign-up.
Future<void> reachPasswordStep(WidgetTester tester) async {
  await tester.tap(find.text('Pas encore de compte ? Créer un compte'));
  await tester.pumpAndSettle();
  expect(find.text('Étape 1 sur 4'), findsOneWidget);
  await tester.tap(find.text("Je veux gagner de l'argent avec mes réseaux"));
  await tester.pumpAndSettle();

  expect(find.text('Étape 2 sur 4'), findsOneWidget);
  // Closed, the country field shows only the flag; open, flag and name.
  expect(find.text('🇹🇬'), findsOneWidget);
  await tester.tap(find.text('🇹🇬'));
  await tester.pumpAndSettle();
  expect(find.text('Togo'), findsOneWidget);
  await tester.tap(find.text('Bénin'));
  await tester.pumpAndSettle();
  expect(find.text('🇧🇯'), findsOneWidget);
  expect(find.text('Bénin'), findsNothing);
  await tester.enterText(
    find.byKey(const Key('identifier')),
    'ama@exemple.com',
  );
  await tester.pump();
  await tester.tap(find.text('Recevoir un code'));
  await tester.pumpAndSettle();

  expect(find.text('Étape 3 sur 4'), findsOneWidget);
  expect(find.text('Code envoyé à a***@exemple.com'), findsOneWidget);
  await tester.enterText(find.byKey(const Key('code')), '123456');
  await tester.tap(find.text('Valider'));
  await tester.pumpAndSettle();
  expect(find.text('Étape 4 sur 4'), findsOneWidget);
}

MockClientHandler registerBackend({
  void Function(Map<String, dynamic> body)? onComplete,
  void Function()? onStart,
}) => (request) async {
  if (request.url.path == '/countries') return json(['TG', 'BJ']);
  final body = jsonDecode(request.body) as Map<String, dynamic>;
  switch (request.url.path) {
    case '/auth/register/start':
      onStart?.call();
      expect(body['identifier'], 'ama@exemple.com');
      return json({'sentTo': 'a***@exemple.com'});
    case '/auth/register/verify':
      expect(body['code'], '123456');
      return json({'ticket': 'ticket-1'});
    case '/auth/register/complete':
      onComplete?.call(body);
      return json({
        'accessToken': 'token',
        'refreshToken': 'refresh',
        'isNew': true,
        'user': userJson(),
      }, 201);
  }
  return json({}, 404);
};

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('logs in with an e-mail and a password', (tester) async {
    final session = sessionWith((request) async {
      expect(request.url.path, '/auth/login');
      final body = jsonDecode(request.body);
      expect(body['identifier'], 'ama@exemple.com');
      expect(body['password'], 'secret123');
      return json({
        'accessToken': 'token',
        'refreshToken': 'refresh',
        'user': userJson(),
      });
    });

    await tester.pumpWidget(
      ViewzoApp(session: session, loggedIn: false, showSplash: false),
    );
    expect(find.text('E-mail'), findsOneWidget);
    expect(find.text('Téléphone'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('identifier')),
      'ama@exemple.com',
    );
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('password')),
        matching: find.byType(EditableText),
      ),
      'secret123',
    );
    await tester.tap(find.text('Se connecter'));
    await tester.pumpAndSettle();

    expect(find.text('Tu es inscrit n° 237 (TG)'), findsOneWidget);
    expect(find.text('Badge Fondateur'), findsOneWidget);
    await tester.tap(find.text('Profil'));
    await tester.pumpAndSettle();
    expect(find.text('ama@exemple.com'), findsOneWidget);
    expect(find.text('Ajouter un numéro'), findsOneWidget);
    expect(session.api.token, 'token');
    final store = session.store as MemoryStore;
    expect(store.values['viewzo.access'], 'token');
    expect(store.values['viewzo.refresh'], 'refresh');
  });

  testWidgets('shows the login error from the server', (tester) async {
    final session = sessionWith(
      (_) async => json({
        'message': ['Identifiant ou mot de passe incorrect'],
      }, 401),
    );

    await tester.pumpWidget(
      ViewzoApp(session: session, loggedIn: false, showSplash: false),
    );
    await tester.enterText(
      find.byKey(const Key('identifier')),
      'ama@exemple.com',
    );
    await tester.tap(find.text('Se connecter'));
    await tester.pumpAndSettle();

    expect(find.text('Identifiant ou mot de passe incorrect'), findsOneWidget);
  });

  testWidgets('opens the define-password screen for accounts without one', (
    tester,
  ) async {
    final session = sessionWith(
      (_) async => json({
        'code': 'PASSWORD_NOT_SET',
        'message': 'Aucun mot de passe sur ce compte',
      }, 403),
    );

    await tester.pumpWidget(
      ViewzoApp(session: session, loggedIn: false, showSplash: false),
    );
    await tester.tap(find.text('Téléphone'));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('identifier')), '+22890123456');
    await tester.tap(find.text('Se connecter'));
    await tester.pumpAndSettle();

    expect(find.text('Définis ton mot de passe'), findsOneWidget);
    expect(find.text('+22890123456'), findsOneWidget);
    expect(find.text('Numéro de téléphone'), findsOneWidget);
    expect(find.text('Recevoir un code'), findsOneWidget);
  });

  testWidgets('signs up by e-mail through the 4 steps', (tester) async {
    Map<String, dynamic>? completed;
    final session = sessionWith(
      registerBackend(onComplete: (body) => completed = body),
    );

    await tester.pumpWidget(
      ViewzoApp(session: session, loggedIn: false, showSplash: false),
    );
    await reachPasswordStep(tester);
    expect(enabled(tester, 'Créer mon compte'), isFalse);
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('firstName')),
        matching: find.byType(EditableText),
      ),
      ' Kofi ',
    );
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('password')),
        matching: find.byType(EditableText),
      ),
      'secret123',
    );
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('confirm')),
        matching: find.byType(EditableText),
      ),
      'secret123',
    );
    await tester.pump();
    expect(enabled(tester, 'Créer mon compte'), isTrue);
    await tester.tap(find.text('Créer mon compte'));
    await tester.pumpAndSettle();

    expect(completed, {
      'ticket': 'ticket-1',
      'password': 'secret123',
      'firstName': 'Kofi',
      'role': 'CREATOR',
      'country': 'BJ',
    });
    expect(find.text('Tu es inscrit n° 237 (TG)'), findsOneWidget);
    expect(session.api.token, 'token');
  });

  testWidgets('tells when the two passwords differ', (tester) async {
    final session = sessionWith(registerBackend());

    await tester.pumpWidget(
      ViewzoApp(session: session, loggedIn: false, showSplash: false),
    );
    await reachPasswordStep(tester);
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('password')),
        matching: find.byType(EditableText),
      ),
      'secret123',
    );
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('confirm')),
        matching: find.byType(EditableText),
      ),
      'secret124',
    );
    await tester.pump();

    expect(find.text('Les mots de passe ne correspondent pas'), findsOneWidget);
    expect(enabled(tester, 'Créer mon compte'), isFalse);
  });

  testWidgets('locks "Renvoyer le code" for 2 minutes', (tester) async {
    var starts = 0;
    final session = sessionWith(registerBackend(onStart: () => starts++));

    await tester.pumpWidget(
      ViewzoApp(session: session, loggedIn: false, showSplash: false),
    );
    await tester.tap(find.text('Pas encore de compte ? Créer un compte'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Je veux faire connaître ma marque'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('identifier')),
      'ama@exemple.com',
    );
    await tester.pump();
    await tester.tap(find.text('Recevoir un code'));
    await tester.pumpAndSettle();

    final resend = find.textContaining('Renvoyer le code dans');
    expect(resend, findsOneWidget);
    expect(
      tester.widget<Text>(resend).data,
      matches(RegExp(r'^Renvoyer le code dans (2:00|1:5\d)$')),
    );
    expect(enabled(tester, tester.widget<Text>(resend).data!), isFalse);
    await tester.tap(resend);
    await tester.pump();
    expect(starts, 1);

    // Back on the identifier step, the same address stays locked.
    await tester.tap(find.text("Changer d'adresse e-mail"));
    await tester.pumpAndSettle();
    expect(find.textContaining('Nouveau code dans'), findsOneWidget);
    expect(find.text("J'ai déjà un code"), findsOneWidget);
  });

  testWidgets('says when the account already exists', (tester) async {
    final session = sessionWith(
      (_) async => json({'message': 'Un compte existe déjà'}, 409),
    );

    await tester.pumpWidget(
      ViewzoApp(session: session, loggedIn: false, showSplash: false),
    );
    await tester.tap(find.text('Pas encore de compte ? Créer un compte'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Je veux faire connaître ma marque'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('identifier')),
      'ama@exemple.com',
    );
    await tester.pump();
    await tester.tap(find.text('Recevoir un code'));
    await tester.pumpAndSettle();

    expect(find.text('Un compte existe déjà'), findsOneWidget);
    await tester.tap(find.text('Se connecter'));
    await tester.pumpAndSettle();
    expect(find.text('Connexion'), findsOneWidget);
  });

  testWidgets('adds a phone number from the home screen', (tester) async {
    final session = sessionWith((request) async {
      final body = jsonDecode(request.body);
      switch (request.url.path) {
        case '/auth/contact/request':
          expect(body['identifier'], '+22890123456');
          return json({'sentTo': '+228****3456'});
        case '/auth/contact/verify':
          expect(body['code'], '654321');
          return json(userJson(phone: '+22890123456'));
      }
      return json({}, 404);
    });
    session.api.token = 'token';

    await tester.pumpWidget(
      VzApp(
        home: HomeScreen(
          session: session,
          initialUser: UserView.fromJson(userJson()),
        ),
      ),
    );
    await tester.tap(find.text('Profil'));
    await tester.pumpAndSettle();
    expect(find.text('Non renseigné'), findsOneWidget);
    await tester.tap(find.text('Ajouter un numéro'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('contact')), '+22890123456');
    await tester.tap(find.text('Recevoir un code'));
    await tester.pumpAndSettle();
    expect(find.text('Code envoyé à +228****3456'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('code')), '654321');
    await tester.tap(find.text('Valider'));
    await tester.pumpAndSettle();

    expect(find.text('+22890123456'), findsOneWidget);
    expect(find.text('Non renseigné'), findsNothing);
  });

  testWidgets('asks a creator signed up by e-mail for a phone first', (
    tester,
  ) async {
    final session = sessionWith((request) async {
      switch (request.url.path) {
        case '/auth/contact/request':
          return json({'sentTo': '+228****3456'});
        case '/auth/contact/verify':
          final body = jsonDecode(request.body);
          expect(body, {'identifier': '90123456', 'code': '654321'});
          return json(userJson(phone: '+22890123456'));
        case '/me/notifications/unread':
          return json({'unread': 0});
      }
      return json({}, 404);
    });
    session.api.token = 'token';

    await tester.pumpWidget(
      VzApp(
        home: HomeScreen(
          session: session,
          initialUser: UserView.fromJson(userJson(phoneRequired: true)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Ajoute ton numéro'), findsOneWidget);
    expect(find.text('Profil'), findsNothing);
    expect(find.text('Voir les campagnes'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('phone')), '90123456');
    await tester.tap(find.text('Recevoir un code'));
    await tester.pumpAndSettle();
    expect(find.text('Code envoyé à +228****3456'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('code')), '654321');
    await tester.tap(find.text('Valider'));
    await tester.pumpAndSettle();

    expect(find.text('Ajoute ton numéro'), findsNothing);
    expect(find.text('Profil'), findsOneWidget);
  });
}
