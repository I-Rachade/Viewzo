import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

const _accessKey = 'viewzo.access';
const _refreshKey = 'viewzo.refresh';
// Where tokens were kept before they moved to the keychain / keystore.
const _legacyTokenKey = 'viewzo.token';
const _deviceKey = 'viewzo.device';

/// Where the tokens are kept: the phone's keychain or keystore, out of
/// backups and other apps' reach.
abstract class SecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class KeychainStore implements SecretStore {
  const KeychainStore();
  static const _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Keeps the session and this phone's id across app restarts.
class Session {
  Session(this.api, {this.store = const KeychainStore()}) {
    // A renewed token is saved at once, so a restart doesn't lose it.
    api.onTokensChanged = save;
  }

  final ApiClient api;
  final SecretStore store;

  Future<bool> restore() async {
    final prefs = await SharedPreferences.getInstance();
    // Tokens from older versions can't be renewed: sign in once again.
    await prefs.remove(_legacyTokenKey);
    api.deviceId = prefs.getString(_deviceKey);
    if (api.deviceId == null) {
      final random = Random.secure();
      api.deviceId = [
        for (var i = 0; i < 16; i++)
          random.nextInt(256).toRadixString(16).padLeft(2, '0'),
      ].join();
      await prefs.setString(_deviceKey, api.deviceId!);
    }
    try {
      api.token = await store.read(_accessKey);
      api.refreshToken = await store.read(_refreshKey);
    } catch (_) {
      // Keychain unreadable (e.g. restored on a new phone): sign in again.
      api.token = null;
      api.refreshToken = null;
    }
    return api.refreshToken != null;
  }

  Future<void> save() async {
    final access = api.token;
    final refresh = api.refreshToken;
    if (access == null || refresh == null) return clear();
    await store.write(_accessKey, access);
    await store.write(_refreshKey, refresh);
  }

  /// Signs out on the server too, then forgets the tokens here.
  Future<void> clear() async {
    await api.logout();
    await store.delete(_accessKey);
    await store.delete(_refreshKey);
  }
}
