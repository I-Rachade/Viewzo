import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

const _tokenKey = 'viewzo.token';

/// Keeps the access token across app restarts.
class Session {
  Session(this.api);
  final ApiClient api;

  Future<bool> restore() async {
    final prefs = await SharedPreferences.getInstance();
    api.token = prefs.getString(_tokenKey);
    return api.token != null;
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, api.token!);
  }

  Future<void> clear() async {
    api.token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
  }
}
