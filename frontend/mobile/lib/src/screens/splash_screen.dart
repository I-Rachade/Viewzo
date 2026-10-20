import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../ui/theme.dart';
import '../ui/widgets.dart';

/// The opening: the ring spins in, the V draws itself, the name, the promise
/// and two floating earnings bubbles rise. Someone new taps "Commencer à
/// gagner" to go on; someone already signed in goes straight to [next].
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, required this.next, this.waitForStart = true});
  final Widget next;

  /// Shows the "Commencer à gagner" button and waits for it.
  final bool waitForStart;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with TickerProviderStateMixin {
  // 1 900 ms in all: 900 for the mark, the rest for the words and a pause.
  late final _intro = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1900),
  )..addStatusListener(_onIntro);

  // After the intro the ring keeps turning slowly and the bubbles float. It
  // runs a few rounds then rests, so the screen never animates forever.
  late final _life = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 3200),
  );

  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (VzMotion.of(context, VzMotion.wide) == Duration.zero) {
      _intro.value = 1;
      if (!widget.waitForStart) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _leave());
      }
    } else {
      _intro.forward();
    }
  }

  void _onIntro(AnimationStatus status) {
    if (status != AnimationStatus.completed) return;
    if (widget.waitForStart) {
      _life.repeat(count: 6);
    } else {
      _leave();
    }
  }

  void _leave() {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      PageRouteBuilder<void>(
        transitionDuration: VzMotion.of(context, VzMotion.wide),
        pageBuilder: (_, _, _) => widget.next,
        transitionsBuilder: (_, animation, _, child) => FadeTransition(
          opacity: CurvedAnimation(parent: animation, curve: VzMotion.easeOut),
          child: child,
        ),
      ),
    );
  }

  @override
  void dispose() {
    _intro.dispose();
    _life.dispose();
    super.dispose();
  }

  double _part(double start, double end, Curve curve) {
    final t = ((_intro.value - start) / (end - start)).clamp(0.0, 1.0);
    return curve.transform(t);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: VzColors.ink,
    body: SafeArea(
      child: AnimatedBuilder(
        animation: Listenable.merge([_intro, _life]),
        builder: (context, _) {
          final intro = _part(0, 0.47, VzMotion.spring);
          final draw = _part(0.22, 0.5, VzMotion.easeOut);
          final name = _part(0.37, 0.6, VzMotion.easeOut);
          final subtitle = _part(0.46, 0.7, VzMotion.easeOut);
          final views = _part(0.58, 0.8, VzMotion.easeOut);
          final money = _part(0.68, 0.9, VzMotion.easeOut);
          final action = _part(0.6, 0.84, VzMotion.easeOut);
          // Gentle up and down, the second bubble half a beat behind.
          double bob(double shift) {
            final t = (_life.value + shift) % 1;
            return -8 * Curves.easeInOut.transform(t < 0.5 ? t * 2 : 2 - t * 2);
          }

          return Padding(
            padding: const EdgeInsets.fromLTRB(28, 24, 28, 24),
            child: Column(
              children: [
                Expanded(
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 280,
                          height: 168,
                          child: Stack(
                            alignment: Alignment.center,
                            children: [
                              VzMark(
                                size: 168,
                                tile: false,
                                intro: intro,
                                draw: draw,
                                ring: _intro.value / 6 + _life.value / 4,
                              ),
                              if (widget.waitForStart) ...[
                                Positioned(
                                  left: 0,
                                  top: 6,
                                  child: _Rise(
                                    t: views,
                                    child: Transform.translate(
                                      offset: Offset(0, bob(0)),
                                      child: const _Bubble(
                                        '+12 vues',
                                        background: VzColors.violetTintDark,
                                        color: Color(0xFFC9BEFF),
                                      ),
                                    ),
                                  ),
                                ),
                                Positioned(
                                  right: 0,
                                  bottom: 18,
                                  child: _Rise(
                                    t: money,
                                    child: Transform.translate(
                                      offset: Offset(0, bob(0.5)),
                                      child: const _Bubble(
                                        '+60 F',
                                        background: Color(0xFF3A1F26),
                                        color: Color(0xFFFFB3B3),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(height: 28),
                        _Rise(
                          t: name,
                          child: const Text(
                            'Viewzo',
                            style: TextStyle(
                              fontFamily: 'Sora',
                              fontWeight: FontWeight.w800,
                              fontSize: 40,
                              letterSpacing: -1.2,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        _Rise(
                          t: subtitle,
                          child: Text(
                            widget.waitForStart
                                ? 'Ton audience vaut de l’argent.'
                                : 'Tes vues, payées. Partout dans le monde.',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 17,
                              color: VzColors.mutedDark,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (widget.waitForStart)
                  _Rise(
                    t: action,
                    child: Column(
                      children: [
                        Pressable(
                          child: ShadButton(
                            width: double.infinity,
                            height: 56,
                            onPressed: _leave,
                            backgroundColor: VzColors.coral,
                            hoverBackgroundColor: const Color(0xFFFF8080),
                            pressedBackgroundColor: const Color(0xFFF25A5A),
                            foregroundColor: VzColors.ink,
                            hoverForegroundColor: VzColors.ink,
                            pressedForegroundColor: VzColors.ink,
                            decoration: ShadDecoration(
                              border: ShadBorder.all(
                                radius: BorderRadius.circular(16),
                                width: 0,
                              ),
                            ),
                            child: const Flexible(
                              child: Text(
                                'Commencer à gagner',
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        const Text(
                          'Tes vues, payées. Partout dans le monde.',
                          style: TextStyle(
                            fontSize: 13,
                            color: VzColors.mutedDark,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    ),
  );
}

class _Bubble extends StatelessWidget {
  const _Bubble(this.label, {required this.background, required this.color});
  final String label;
  final Color background;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(
      label,
      style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w700),
    ),
  );
}

class _Rise extends StatelessWidget {
  const _Rise({required this.t, required this.child});
  final double t;
  final Widget child;

  @override
  Widget build(BuildContext context) => Opacity(
    opacity: t,
    child: Transform.translate(offset: Offset(0, 14 * (1 - t)), child: child),
  );
}
