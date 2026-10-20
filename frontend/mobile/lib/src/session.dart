import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

const _tokenKey = 'viewzo.token';
const _deviceKey = 'viewzo.device';

/// Keeps the access token and this phone's id across app restarts.
class Session {
  Session(this.api);
  final ApiClient api;

  Future<bool> restore() async {
    final prefs = await SharedPreferences.getInstance();
    api.token = prefs.getString(_tokenKey);
    api.deviceId = prefs.getString(_deviceKey);
    if (api.deviceId == null) {
      final random = Random.secure();
      api.deviceId = [
        for (var i = 0; i < 16; i++)
          random.nextInt(256).toRadixString(16).padLeft(2, '0'),
      ].join();
      await prefs.setString(_deviceKey, api.deviceId!);
    }
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
