import 'package:flutter/material.dart';

import 'src/api_client.dart';
import 'src/screens/home_screen.dart';
import 'src/screens/login_screen.dart';
import 'src/screens/splash_screen.dart';
import 'src/session.dart';
import 'src/ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session(ApiClient());
  final loggedIn = await session.restore();
  runApp(ViewzoApp(session: session, loggedIn: loggedIn));
}

class ViewzoApp extends StatelessWidget {
  const ViewzoApp({
    super.key,
    required this.session,
    required this.loggedIn,
    this.showSplash = true,
  });
  final Session session;
  final bool loggedIn;
  final bool showSplash;

  @override
  Widget build(BuildContext context) {
    final start = loggedIn
        ? HomeScreen(session: session)
        : LoginScreen(session: session);
    return MaterialApp(
      title: 'Viewzo',
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      home: showSplash ? SplashScreen(next: start) : start,
    );
  }
}
