import 'package:flutter/material.dart';

/// Viewzo brand colours (see the visual identity sheet).
abstract final class VzColors {
  static const violet = Color(0xFF5B3DF5);
  static const lilac = Color(0xFF8B74FF);
  static const coral = Color(0xFFFF6B6B);
  static const ink = Color(0xFF16151D);
  static const night = Color(0xFF111017);
  static const nightSurface = Color(0xFF1B1A24);
  static const nightLine = Color(0xFF2D2B3A);
  static const mist = Color(0xFFF7F7FB);
  static const line = Color(0xFFE3E2EC);
  static const muted = Color(0xFF6B6A78);
  static const mutedDark = Color(0xFFA3A1B5);
  static const paid = Color(0xFF1FA971);
  // Darker green for text on white, which keeps 4.5:1 contrast.
  static const paidText = Color(0xFF148A5A);
  static const amber = Color(0xFFF5A524);
  static const red = Color(0xFFC62828);
  static const violetTint = Color(0xFFEFEBFF);
  static const violetTintDark = Color(0xFF2A2440);
}

/// The four motion speeds of the UI kit. Nothing lasts longer than 640 ms.
abstract final class VzMotion {
  static const fast = Duration(milliseconds: 150);
  static const standard = Duration(milliseconds: 240);
  static const wide = Duration(milliseconds: 420);
  static const bounce = Duration(milliseconds: 640);

  /// Soft exit, for entrances and screen changes.
  static const easeOut = Cubic(0.2, 0.8, 0.2, 1);

  /// Spring, kept for earnings: success ticks, toasts, chart bars.
  static const spring = Cubic(0.34, 1.56, 0.64, 1);

  /// Each card of a list starts this much after the previous one.
  static const stagger = Duration(milliseconds: 60);

  /// Zero when the phone asks for fewer animations.
  static Duration of(BuildContext context, Duration d) =>
      MediaQuery.maybeDisableAnimationsOf(context) == true ? Duration.zero : d;
}

const _display = 'Sora';
const _body = 'DMSans';

ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final background = dark ? VzColors.night : VzColors.mist;
  final surface = dark ? VzColors.nightSurface : Colors.white;
  final onSurface = dark ? const Color(0xFFF1F0F7) : VzColors.ink;
  final muted = dark ? VzColors.mutedDark : VzColors.muted;
  final line = dark ? VzColors.nightLine : VzColors.line;
  final primary = dark ? VzColors.lilac : VzColors.violet;

  final scheme = ColorScheme(
    brightness: brightness,
    primary: primary,
    onPrimary: dark ? VzColors.ink : Colors.white,
    primaryContainer: dark ? VzColors.violetTintDark : VzColors.violetTint,
    onPrimaryContainer: dark ? const Color(0xFFC9BEFF) : VzColors.violet,
    secondary: VzColors.coral,
    onSecondary: VzColors.ink,
    tertiary: VzColors.paid,
    onTertiary: Colors.white,
    error: dark ? VzColors.coral : VzColors.red,
    onError: Colors.white,
    surface: surface,
    onSurface: onSurface,
    onSurfaceVariant: muted,
    surfaceContainerLowest: background,
    surfaceContainerLow: background,
    surfaceContainer: surface,
    surfaceContainerHigh: surface,
    surfaceContainerHighest: dark
        ? VzColors.violetTintDark
        : VzColors.violetTint,
    outline: line,
    outlineVariant: line,
    inverseSurface: dark ? Colors.white : VzColors.ink,
    onInverseSurface: dark ? VzColors.ink : Colors.white,
  );

  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: _body,
    scaffoldBackgroundColor: background,
  );
  final text = base.textTheme;
  TextStyle? display(TextStyle? s, FontWeight w) =>
      s?.copyWith(fontFamily: _display, fontWeight: w, letterSpacing: -0.3);
  final radius14 = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(14),
  );
  const buttonSize = Size(64, 48);
  final buttonText = const TextStyle(
    fontFamily: _body,
    fontWeight: FontWeight.w700,
    fontSize: 15,
  );

  return base.copyWith(
    textTheme: text.copyWith(
      displaySmall: display(text.displaySmall, FontWeight.w800),
      headlineLarge: display(text.headlineLarge, FontWeight.w700),
      headlineMedium: display(text.headlineMedium, FontWeight.w700),
      headlineSmall: display(text.headlineSmall, FontWeight.w700),
      titleLarge: display(text.titleLarge, FontWeight.w700),
      titleMedium: display(text.titleMedium, FontWeight.w600),
      labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w700),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: background,
      foregroundColor: onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: _display,
        fontWeight: FontWeight.w700,
        fontSize: 20,
        color: onSurface,
      ),
    ),
    cardTheme: CardThemeData(
      color: surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: buttonSize,
        shape: radius14,
        textStyle: buttonText,
        animationDuration: VzMotion.fast,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: buttonSize,
        shape: radius14,
        textStyle: buttonText,
        foregroundColor: onSurface,
        side: BorderSide(color: line),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(shape: radius14, textStyle: buttonText),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: scheme.primaryContainer,
      labelStyle: TextStyle(
        fontFamily: _body,
        fontWeight: FontWeight.w700,
        fontSize: 12,
        color: scheme.onPrimaryContainer,
      ),
      side: BorderSide.none,
      shape: const StadiumBorder(),
      padding: const EdgeInsets.symmetric(horizontal: 4),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: line, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: line, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: primary, width: 1.5),
      ),
    ),
    listTileTheme: ListTileThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      iconColor: primary,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: dark ? Colors.white : VzColors.ink,
      contentTextStyle: TextStyle(
        fontFamily: _body,
        fontSize: 14,
        color: dark ? VzColors.ink : Colors.white,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
    tabBarTheme: TabBarThemeData(
      labelColor: primary,
      unselectedLabelColor: muted,
      indicatorColor: primary,
      dividerColor: line,
      labelStyle: const TextStyle(
        fontFamily: _body,
        fontWeight: FontWeight.w700,
      ),
    ),
    dividerTheme: DividerThemeData(color: line, space: 1),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: primary),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: VzPageTransitionsBuilder(),
        TargetPlatform.iOS: VzPageTransitionsBuilder(),
        TargetPlatform.linux: VzPageTransitionsBuilder(),
        TargetPlatform.macOS: VzPageTransitionsBuilder(),
        TargetPlatform.windows: VzPageTransitionsBuilder(),
      },
    ),
  );
}

/// New screens fade in while rising 24 px.
class VzPageTransitionsBuilder extends PageTransitionsBuilder {
  const VzPageTransitionsBuilder();

  @override
  Duration get transitionDuration => VzMotion.wide;

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final curved = CurvedAnimation(parent: animation, curve: VzMotion.easeOut);
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween(
          begin: const Offset(0, 0.03),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
}
