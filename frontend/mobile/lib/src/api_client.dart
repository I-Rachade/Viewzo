import 'dart:convert';

import 'package:http/http.dart' as http;

import 'creator_models.dart';

const apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://localhost:3001',
);

enum ProfileType {
  creator('CREATOR', 'Créateur'),
  advertiser('ADVERTISER', 'Annonceur'),
  provider('PROVIDER', 'Prestataire créatif');

  const ProfileType(this.code, this.label);
  final String code;
  final String label;

  static ProfileType fromCode(String code) =>
      values.firstWhere((t) => t.code == code);
}

class UserProfile {
  UserProfile(this.type, this.level);
  final ProfileType type;
  final int level;
}

class UserView {
  UserView({
    required this.phone,
    required this.country,
    required this.priorityRank,
    required this.isFounder,
    required this.profiles,
  });

  factory UserView.fromJson(Map<String, dynamic> json) => UserView(
    phone: json['phone'] as String,
    country: json['country'] as String,
    priorityRank: json['priorityRank'] as int,
    isFounder: json['isFounder'] as bool,
    profiles: [
      for (final p in json['profiles'] as List)
        UserProfile(
          ProfileType.fromCode(p['type'] as String),
          p['level'] as int,
        ),
    ],
  );

  final String phone;
  final String country;
  final int priorityRank;
  final bool isFounder;
  final List<UserProfile> profiles;
}

class ApiException implements Exception {
  ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({http.Client? client, this.baseUrl = apiUrl})
    : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  String? token;

  Future<String> requestCode(String phone) async {
    final body = await _post('/auth/otp/request', {'phone': phone});
    return body['phone'] as String;
  }

  Future<UserView> verifyCode(String phone, String code) async {
    final body = await _post('/auth/otp/verify', {
      'phone': phone,
      'code': code,
    });
    token = body['accessToken'] as String;
    return UserView.fromJson(body['user'] as Map<String, dynamic>);
  }

  Future<UserView> me() async {
    final res = await _client.get(Uri.parse('$baseUrl/me'), headers: _headers);
    return UserView.fromJson(_decode(res));
  }

  Future<UserView> activateProfile(ProfileType type) async {
    return UserView.fromJson(await _post('/me/profiles', {'type': type.code}));
  }

  Future<List<SocialAccount>> accounts() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/accounts'),
      headers: _headers,
    );
    return [
      for (final a in _decodeList(res))
        SocialAccount.fromJson(a as Map<String, dynamic>),
    ];
  }

  Future<SocialAccount> addAccount(SocialNetwork network, String handle) async {
    return SocialAccount.fromJson(
      await _post('/me/accounts', {'network': network.code, 'handle': handle}),
    );
  }

  Future<SocialAccount> resubmitAccount(String id) async {
    return SocialAccount.fromJson(await _post('/me/accounts/$id/resubmit', {}));
  }

  Future<void> removeAccount(String id) async {
    final res = await _client.delete(
      Uri.parse('$baseUrl/me/accounts/$id'),
      headers: _headers,
    );
    _decode(res);
  }

  /// Null until the creator has filled in the skills form once.
  Future<CreatorSkills?> skills() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/skills'),
      headers: _headers,
    );
    final body = _decode(res);
    return body.isEmpty ? null : CreatorSkills.fromJson(body);
  }

  Future<CreatorSkills> saveSkills(CreatorSkills skills) async {
    final res = await _client.put(
      Uri.parse('$baseUrl/me/skills'),
      headers: _headers,
      body: jsonEncode(skills.toJson()),
    );
    return CreatorSkills.fromJson(_decode(res));
  }

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (token != null) 'Authorization': 'Bearer $token',
  };

  Future<Map<String, dynamic>> _post(String path, Object body) async {
    final res = await _client.post(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return _decode(res);
  }

  List<dynamic> _decodeList(http.Response res) {
    if (res.statusCode >= 400) _decode(res);
    return jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
  }

  Map<String, dynamic> _decode(http.Response res) {
    final body = res.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      final message = body['message'];
      throw ApiException(
        message is List
            ? message.first.toString()
            : (message?.toString() ?? 'Une erreur est survenue'),
      );
    }
    return body;
  }
}
