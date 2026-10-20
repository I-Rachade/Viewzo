import 'dart:convert';

import 'package:http/http.dart' as http;

import 'creator_models.dart';
import 'identity_models.dart';
import 'live_models.dart';
import 'task_models.dart';
import 'wallet_models.dart';

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
    required this.email,
    this.firstName,
    required this.hasPassword,
    this.phoneRequired = false,
    required this.country,
    required this.priorityRank,
    required this.isFounder,
    required this.profiles,
  });

  factory UserView.fromJson(Map<String, dynamic> json) => UserView(
    phone: json['phone'] as String?,
    email: json['email'] as String?,
    firstName: json['firstName'] as String?,
    hasPassword: json['hasPassword'] as bool? ?? false,
    phoneRequired: json['phoneRequired'] as bool? ?? false,
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

  final String? phone;
  final String? email;

  /// Null until given at sign-up, on the web or by the verified ID.
  final String? firstName;
  final bool hasPassword;

  /// A creator without a verified phone: only the phone screen is open.
  final bool phoneRequired;
  final String country;
  final int priorityRank;
  final bool isFounder;
  final List<UserProfile> profiles;
}

class ApiException implements Exception {
  ApiException(this.message, {this.code, this.statusCode});
  final String message;

  /// Machine-readable reason sent by some endpoints, e.g. PASSWORD_NOT_SET.
  final String? code;
  final int? statusCode;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({http.Client? client, this.baseUrl = apiUrl})
    : _raw = client ?? http.Client() {
    _client = _RenewingClient(_raw, this);
  }

  final http.Client _raw;
  late final http.Client _client;
  final String baseUrl;

  /// Short-lived; renewed with [refreshToken] when the API refuses it.
  String? token;
  String? refreshToken;

  /// Called after a renewal or when the session ended, to save the tokens.
  Future<void> Function()? onTokensChanged;

  Future<bool>? _refreshing;

  /// Swaps the refresh token for new tokens; false when the session is over.
  Future<bool> renew() {
    return _refreshing ??= _renew().whenComplete(() => _refreshing = null);
  }

  Future<bool> _renew() async {
    final current = refreshToken;
    if (current == null) return false;
    final res = await _raw.post(
      Uri.parse('$baseUrl/auth/refresh'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'refreshToken': current}),
    );
    if (res.statusCode == 401) {
      token = null;
      refreshToken = null;
      await onTokensChanged?.call();
      return false;
    }
    if (res.statusCode >= 400) return false;
    _keepTokens(_decode(res));
    await onTokensChanged?.call();
    return true;
  }

  /// Ends the session on the server; the tokens are forgotten either way.
  Future<void> logout() async {
    final current = refreshToken;
    token = null;
    refreshToken = null;
    if (current == null) return;
    try {
      await _raw.post(
        Uri.parse('$baseUrl/auth/logout'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': current}),
      );
    } catch (_) {
      // Offline: the server session expires on its own.
    }
  }

  void _keepTokens(Map<String, dynamic> body) {
    token = body['accessToken'] as String;
    refreshToken = body['refreshToken'] as String?;
  }

  /// Random id kept on this phone; the team sees when accounts share one.
  String? deviceId;

  /// [identifier] is an e-mail address or a phone number.
  Future<String> registerStart(String identifier) async {
    final body = await _post('/auth/register/start', {
      'identifier': identifier,
    });
    return body['sentTo'] as String;
  }

  /// Returns the ticket that lets [registerComplete] create the account.
  Future<String> registerVerify(String identifier, String code) async {
    final body = await _post('/auth/register/verify', {
      'identifier': identifier,
      'code': code,
    });
    return body['ticket'] as String;
  }

  /// [country] (ISO2) is only needed for e-mail sign-ups.
  Future<UserView> registerComplete({
    required String ticket,
    required String password,
    required ProfileType role,
    String? country,
    String? firstName,
  }) async {
    return _signIn(
      await _post('/auth/register/complete', {
        'ticket': ticket,
        'password': password,
        'role': role.code,
        'firstName': ?firstName,
        'country': ?country,
      }),
    );
  }

  /// ISO2 codes of the countries Viewzo works in, set in the back-office.
  Future<List<String>> allowedCountries() async {
    final res = await _client.get(Uri.parse('$baseUrl/countries'));
    return [for (final c in _decodeList(res)) c as String];
  }

  Future<UserView> login(String identifier, String password) async {
    return _signIn(
      await _post('/auth/login', {
        'identifier': identifier,
        'password': password,
      }),
    );
  }

  Future<String> forgotPassword(String identifier) async {
    final body = await _post('/auth/password/forgot', {
      'identifier': identifier,
    });
    return body['sentTo'] as String;
  }

  Future<UserView> resetPassword(
    String identifier,
    String code,
    String password,
  ) async {
    return _signIn(
      await _post('/auth/password/reset', {
        'identifier': identifier,
        'code': code,
        'password': password,
      }),
    );
  }

  /// Sends a code to an e-mail or number to add to the logged-in account.
  Future<String> contactRequest(String identifier) async {
    final body = await _post('/auth/contact/request', {
      'identifier': identifier,
    });
    return body['sentTo'] as String;
  }

  Future<UserView> contactVerify(String identifier, String code) async {
    return UserView.fromJson(
      await _post('/auth/contact/verify', {
        'identifier': identifier,
        'code': code,
      }),
    );
  }

  UserView _signIn(Map<String, dynamic> body) {
    _keepTokens(body);
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

  /// The creator confirms the account is theirs and not anonymous; the
  /// follower count is optional, the team checks it.
  Future<SocialAccount> addAccount(
    SocialNetwork network,
    String handle, {
    int? followers,
  }) async {
    return SocialAccount.fromJson(
      await _post('/me/accounts', {
        'network': network.code,
        'handle': handle,
        'followers': ?followers,
        'notAnonymous': true,
      }),
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

  Future<List<CampaignTask>> availableTasks() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/tasks'),
      headers: _headers,
    );
    return [
      for (final t in _decodeList(res))
        CampaignTask.fromJson(t as Map<String, dynamic>),
    ];
  }

  Future<Assignment> acceptTask(String taskId) async {
    return Assignment.fromJson(await _post('/tasks/$taskId/accept', {}));
  }

  Future<List<Assignment>> assignments() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/assignments'),
      headers: _headers,
    );
    return [
      for (final a in _decodeList(res))
        Assignment.fromJson(a as Map<String, dynamic>),
    ];
  }

  Future<Assignment> submitPost(String assignmentId, String postUrl) async {
    return Assignment.fromJson(
      await _post('/me/assignments/$assignmentId/submit', {'postUrl': postUrl}),
    );
  }

  Future<CreatorResults> results() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/results'),
      headers: _headers,
    );
    return CreatorResults.fromJson(_decode(res));
  }

  /// Sends a screenshot showing [declaredViews] as proof for a post.
  Future<void> addScreenshot(
    String assignmentId, {
    required List<int> bytes,
    required String filename,
    required int declaredViews,
    DateTime? capturedAt,
  }) async {
    final request =
        http.MultipartRequest(
            'POST',
            Uri.parse('$baseUrl/me/assignments/$assignmentId/proofs'),
          )
          ..headers.addAll({
            if (token != null) 'Authorization': 'Bearer $token',
            'X-Device-Id': ?deviceId,
          })
          ..fields['declaredViews'] = '$declaredViews'
          ..files.add(
            http.MultipartFile.fromBytes('file', bytes, filename: filename),
          );
    if (capturedAt != null) {
      request.fields['capturedAt'] = capturedAt.toUtc().toIso8601String();
    }
    _decode(await http.Response.fromStream(await _client.send(request)));
  }

  Future<(int, List<AppNotification>)> notifications() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/notifications'),
      headers: _headers,
    );
    final body = _decode(res);
    return (
      body['unread'] as int,
      [
        for (final n in body['items'] as List)
          AppNotification.fromJson(n as Map<String, dynamic>),
      ],
    );
  }

  Future<int> unreadNotifications() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/notifications/unread'),
      headers: _headers,
    );
    return _decode(res)['unread'] as int;
  }

  /// Marks all notifications read.
  Future<void> readNotifications() => _post('/me/notifications/read', {});

  Future<List<Connection>> connections() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/connections'),
      headers: _headers,
    );
    return [
      for (final c in _decodeList(res))
        Connection.fromJson(c as Map<String, dynamic>),
    ];
  }

  /// The platform page where the creator logs in to connect the account.
  Future<String> connectionStartUrl(SocialNetwork network) async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/connections/${network.code}/start'),
      headers: _headers,
    );
    return _decode(res)['url'] as String;
  }

  Future<void> disconnect(SocialNetwork network) async {
    final res = await _client.delete(
      Uri.parse('$baseUrl/me/connections/${network.code}'),
      headers: _headers,
    );
    _decode(res);
  }

  Future<IdentityStatus> identity() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/identity'),
      headers: _headers,
    );
    return IdentityStatus.fromJson(_decode(res));
  }

  /// Opens a verification and returns the provider's page to send the person to.
  Future<IdentityCheck> startIdentity() async =>
      IdentityCheck.fromJson(await _post('/me/identity/start', {}));

  /// Asks the provider again after the person comes back from its page.
  Future<IdentityCheck> refreshIdentity() async =>
      IdentityCheck.fromJson(await _post('/me/identity/refresh', {}));

  Future<WalletSummary> wallet() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/wallet'),
      headers: _headers,
    );
    return WalletSummary.fromJson(_decode(res));
  }

  Future<List<WalletTransaction>> walletTransactions() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/wallet/transactions'),
      headers: _headers,
    );
    return [
      for (final t in _decodeList(res))
        WalletTransaction.fromJson(t as Map<String, dynamic>),
    ];
  }

  Future<Payment> deposit(int amount) async {
    return Payment.fromJson(
      await _post('/me/wallet/deposits', {'amount': amount}),
    );
  }

  Future<Payment> withdraw({
    required int amount,
    required String beneficiaryName,
    String? operator,
  }) async {
    return Payment.fromJson(
      await _post('/me/wallet/withdrawals', {
        'amount': amount,
        'beneficiaryName': beneficiaryName,
        'operator': ?operator,
      }),
    );
  }

  /// Modules the team switched on; screens of the others stay hidden.
  Future<List<String>> enabledModules() async {
    final res = await _client.get(Uri.parse('$baseUrl/modules'));
    return [for (final m in _decodeList(res)) m as String];
  }

  Future<List<LiveSale>> liveSales() async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/live/sales'),
      headers: _headers,
    );
    return [
      for (final l in _decodeList(res))
        LiveSale.fromJson(l as Map<String, dynamic>),
    ];
  }

  Future<LiveBoard> liveBoard(String id) async {
    final res = await _client.get(
      Uri.parse('$baseUrl/me/live/sales/$id'),
      headers: _headers,
    );
    return LiveBoard.fromJson(_decode(res));
  }

  Future<void> startLive(String id) => _post('/me/live/sales/$id/start', {});

  Future<void> stopLive(String id) => _post('/me/live/sales/$id/stop', {});

  Future<void> setLeadStatus(
    String liveId,
    String leadId,
    String status,
  ) async {
    final res = await _client.patch(
      Uri.parse('$baseUrl/me/live/sales/$liveId/leads/$leadId'),
      headers: _headers,
      body: jsonEncode({'status': status}),
    );
    _decode(res);
  }

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (token != null) 'Authorization': 'Bearer $token',
    'X-Device-Id': ?deviceId,
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
        code: body['code'] as String?,
        statusCode: res.statusCode,
      );
    }
    return body;
  }
}

/// Adds the access token to every request and, when the API says it
/// expired, renews it once and sends the request again.
class _RenewingClient extends http.BaseClient {
  _RenewingClient(this._inner, this._api);
  final http.Client _inner;
  final ApiClient _api;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path.startsWith('/auth/') || _api.token == null) {
      return _inner.send(request);
    }
    // Renew ahead of time: an upload can't be sent twice.
    if (_expiresSoon(_api.token!)) await _api.renew();
    // A plain request can be sent twice; keep its body for the retry.
    final retry = request is http.Request ? _copy(request) : null;
    _authorize(request);
    final res = await _inner.send(request);
    if (res.statusCode != 401 || _api.refreshToken == null) return res;
    if (!await _api.renew()) return res;
    if (retry == null) return res;
    await res.stream.drain<void>();
    _authorize(retry);
    return _inner.send(retry);
  }

  /// Whether the access token expires within the next 30 seconds.
  static bool _expiresSoon(String token) {
    try {
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(token.split('.')[1]))),
      );
      final exp = (payload as Map<String, dynamic>)['exp'] as int;
      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      return exp - now < 30;
    } catch (_) {
      // Not a token we can read: let the API decide.
      return false;
    }
  }

  void _authorize(http.BaseRequest request) {
    final token = _api.token;
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
  }

  http.Request _copy(http.Request r) => http.Request(r.method, r.url)
    ..headers.addAll(r.headers)
    ..bodyBytes = r.bodyBytes
    ..followRedirects = r.followRedirects
    ..maxRedirects = r.maxRedirects;
}
