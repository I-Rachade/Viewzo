import 'package:flutter/material.dart';

import '../ui/theme.dart';
import '../ui/widgets.dart';

/// The opening: the ring spins in, the V draws itself, the name and the
/// promise rise, then [next] fades in.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, required this.next});
  final Widget next;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  // 1 900 ms in all: 900 for the mark, the rest for the words and a pause.
  late final _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1900),
  )..addStatusListener(_onStatus);

  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (VzMotion.of(context, VzMotion.wide) == Duration.zero) {
      _controller.value = 1;
      WidgetsBinding.instance.addPostFrameCallback((_) => _leave());
    } else {
      _controller.forward();
    }
  }

  void _onStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) _leave();
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
    _controller.dispose();
    super.dispose();
  }

  double _part(double start, double end, Curve curve) {
    final t = ((_controller.value - start) / (end - start)).clamp(0.0, 1.0);
    return curve.transform(t);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: VzColors.ink,
    body: Center(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final intro = _part(0, 0.47, VzMotion.spring);
          final draw = _part(0.22, 0.5, VzMotion.easeOut);
          final name = _part(0.37, 0.6, VzMotion.easeOut);
          final promise = _part(0.46, 0.7, VzMotion.easeOut);
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              VzMark(
                size: 152,
                tile: false,
                intro: intro,
                draw: draw,
                ring: _controller.value / 6,
              ),
              const SizedBox(height: 24),
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
              const SizedBox(height: 8),
              _Rise(
                t: promise,
                child: const Text(
                  'Tes vues, payées. Partout dans le monde.',
                  style: TextStyle(fontSize: 16, color: VzColors.mutedDark),
                ),
              ),
            ],
          );
        },
      ),
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
