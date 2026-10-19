import 'package:flutter/material.dart';

import 'src/api_client.dart';
import 'src/screens/home_screen.dart';
import 'src/screens/login_screen.dart';
import 'src/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session(ApiClient());
  final loggedIn = await session.restore();
  runApp(ViewzoApp(session: session, loggedIn: loggedIn));
}

class ViewzoApp extends StatelessWidget {
  const ViewzoApp({super.key, required this.session, required this.loggedIn});
  final Session session;
  final bool loggedIn;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Viewzo',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF5B3DF5)),
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF5B3DF5),
          brightness: Brightness.dark,
        ),
      ),
      home: loggedIn
          ? HomeScreen(session: session)
          : LoginScreen(session: session),
    );
  }
}
