import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image_picker/image_picker.dart';
import 'package:viewzo/main.dart';
import 'package:viewzo/src/api_client.dart';
import 'package:viewzo/src/screens/identity_screen.dart';

http.Response json(Object body, [int status = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), status);

void main() {
  testWidgets('sends the ID photos and the selfie, then shows the review', (
    tester,
  ) async {
    Map<String, dynamic>? check;
    final client = MockClient((request) async {
      if (request.url.path == '/me/identity') {
        return json({
          'available': true,
          'verified': false,
          'needsProfile': false,
          'check': check,
          'retryAfter': null,
        });
      }
      return http.Response('', 404);
    });
    http.MultipartRequest? upload;
    final api = ApiClient(
      client: _Spy(client, (r) {
        upload = r;
        check = {
          'id': 'c1',
          'status': 'IN_REVIEW',
          'fullName': null,
          'reason': null,
        };
      }, () => check!),
    );
    final picked = <IdentityPhoto>[];

    await tester.pumpWidget(
      VzApp(
        home: IdentityScreen(
          api: api,
          pickImage: (photo) async {
            picked.add(photo);
            return XFile.fromData(
              base64Decode(_png),
              path: '${photo.name}.jpg',
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('1. Recto de la pièce'), findsOneWidget);

    // The back is optional: front and selfie are enough to send.
    await tester.tap(find.text('Photo').first);
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('3. Selfie'), 200);
    await tester.tap(find.text('Photo').last);
    await tester.pumpAndSettle();
    expect(picked, [IdentityPhoto.front, IdentityPhoto.selfie]);
    expect(find.text('Refaire'), findsNWidgets(2));

    await tester.ensureVisible(find.text('Envoyer pour vérification'));
    await tester.tap(find.text('Envoyer pour vérification'));
    await tester.pumpAndSettle();

    expect(upload!.url.path, '/me/identity');
    expect(upload!.files.map((f) => f.field), ['front', 'selfie']);
    expect(find.text('En examen'), findsOneWidget);
  });
}

class _Spy extends http.BaseClient {
  _Spy(this.inner, this.onUpload, this.answer);
  final http.Client inner;
  final void Function(http.MultipartRequest) onUpload;
  final Map<String, dynamic> Function() answer;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request is http.MultipartRequest) {
      onUpload(request);
      return http.StreamedResponse(
        Stream.value(utf8.encode(jsonEncode(answer()))),
        200,
      );
    }
    return inner.send(request);
  }
}

// A 1×1 PNG.
const _png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
