import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import 'theme.dart';

/// Shrinks its child slightly while a finger is on it.
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, this.scale = 0.96});
  final Widget child;
  final double scale;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  void _set(bool down) {
    if (_down != down) setState(() => _down = down);
  }

  @override
  Widget build(BuildContext context) => Listener(
    onPointerDown: (_) => _set(true),
    onPointerUp: (_) => _set(false),
    onPointerCancel: (_) => _set(false),
    child: AnimatedScale(
      scale: _down ? widget.scale : 1,
      duration: VzMotion.of(context, VzMotion.fast),
      curve: Curves.easeOut,
      child: widget.child,
    ),
  );
}

/// Fades a list item in while it rises, each item [VzMotion.stagger] after
/// the previous one. Runs once, when the item first appears.
class FadeSlideIn extends StatefulWidget {
  const FadeSlideIn({super.key, required this.child, this.index = 0});
  final Widget child;
  final int index;

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _curve;

  @override
  void initState() {
    super.initState();
    // Later items wait inside one controller, so no timer is left behind.
    final index = math.min(widget.index, 8);
    final delay = VzMotion.stagger * index;
    final total = delay + VzMotion.wide;
    _controller = AnimationController(vsync: this, duration: total);
    _curve = CurvedAnimation(
      parent: _controller,
      curve: Interval(
        delay.inMilliseconds / total.inMilliseconds,
        1,
        curve: VzMotion.easeOut,
      ),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_controller.isAnimating || _controller.isCompleted) return;
    if (VzMotion.of(context, VzMotion.wide) == Duration.zero) {
      _controller.value = 1;
    } else {
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: _curve,
    child: AnimatedBuilder(
      animation: _curve,
      builder: (context, child) => Transform.translate(
        offset: Offset(0, 16 * (1 - _curve.value)),
        child: child,
      ),
      child: widget.child,
    ),
  );
}

/// Counts up from zero to [value] the first time it shows.
class AnimatedCount extends StatelessWidget {
  const AnimatedCount({
    super.key,
    required this.value,
    required this.format,
    this.style,
  });
  final int value;
  final String Function(int) format;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: value.toDouble()),
    duration: VzMotion.of(context, VzMotion.bounce),
    curve: VzMotion.easeOut,
    builder: (context, v, _) => Text(
      format(v.round()),
      style: style?.copyWith(
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    ),
  );
}

enum PillTone { violet, paid, pending, refused, neutral }

/// A small rounded label: a network, a status.
class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.tone = PillTone.violet});
  final String label;
  final PillTone tone;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final (bg, fg) = switch (tone) {
      PillTone.violet =>
        dark
            ? (VzColors.violetTintDark, const Color(0xFFC9BEFF))
            : (VzColors.violetTint, VzColors.violet),
      PillTone.paid =>
        dark
            ? (const Color(0xFF173A2B), const Color(0xFF7BE0B0))
            : (const Color(0xFFDDF6E8), const Color(0xFF14804F)),
      PillTone.pending =>
        dark
            ? (const Color(0xFF3A2E14), const Color(0xFFFFD27A))
            : (const Color(0xFFFFF1D6), const Color(0xFF8A5600)),
      PillTone.refused =>
        dark
            ? (const Color(0xFF3A1F26), const Color(0xFFFFB3B3))
            : (const Color(0xFFFFE3E3), const Color(0xFFB42318)),
      PillTone.neutral =>
        dark
            ? (VzColors.nightLine, VzColors.mutedDark)
            : (VzColors.line, VzColors.muted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// The Viewzo mark: the segmented status ring around the V.
///
/// [ring] turns the ring (0 to 1 is one full turn), [draw] draws the V from
/// 0 to 1, and [intro] grows and fades the ring in.
class VzMark extends StatelessWidget {
  const VzMark({
    super.key,
    this.size = 40,
    this.tile = true,
    this.ring = 0,
    this.draw = 1,
    this.intro = 1,
  });
  final double size;
  final bool tile;
  final double ring;
  final double draw;
  final double intro;

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: Size.square(size),
    painter: _MarkPainter(tile: tile, ring: ring, draw: draw, intro: intro),
  );
}

class _MarkPainter extends CustomPainter {
  _MarkPainter({
    required this.tile,
    required this.ring,
    required this.draw,
    required this.intro,
  });
  final bool tile;
  final double ring;
  final double draw;
  final double intro;

  @override
  void paint(Canvas canvas, Size size) {
    // Drawn on the 64-unit grid of the SVG logo.
    final unit = size.width / 64;
    canvas.scale(unit);
    if (tile) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          const Rect.fromLTWH(0, 0, 64, 64),
          const Radius.circular(16),
        ),
        Paint()..color = VzColors.ink,
      );
    }

    const center = Offset(32, 32);
    const radius = 21.0;
    const gap = 4.0;
    const circumference = 2 * math.pi * radius;
    const segments = 6;
    const dash = circumference / segments - gap;
    final ringPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4.5
      ..strokeCap = StrokeCap.round
      ..shader = const LinearGradient(
        colors: [VzColors.lilac, VzColors.coral],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(const Rect.fromLTWH(-21, -21, 42, 42));

    canvas.save();
    canvas.translate(center.dx, center.dy);
    final scale = 0.55 + 0.45 * intro;
    canvas.scale(scale);
    canvas.rotate((ring - (1 - intro) / 3) * 2 * math.pi - 80 * math.pi / 180);
    canvas.saveLayer(
      null,
      Paint()..color = Colors.white.withValues(alpha: intro.clamp(0, 1)),
    );
    for (var i = 0; i < segments; i++) {
      final start = i * (dash + gap) / radius;
      canvas.drawArc(
        Rect.fromCircle(center: Offset.zero, radius: radius),
        start,
        dash / radius,
        false,
        ringPaint,
      );
    }
    canvas.restore();
    canvas.restore();

    if (draw > 0) {
      final v = Path()
        ..moveTo(23, 25)
        ..lineTo(32, 41)
        ..lineTo(41, 25);
      final metric = v.computeMetrics().first;
      canvas.drawPath(
        metric.extractPath(0, metric.length * draw.clamp(0, 1)),
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.stroke
          ..strokeWidth = 6.5
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round,
      );
    }
  }

  @override
  bool shouldRepaint(_MarkPainter old) =>
      old.ring != ring || old.draw != draw || old.intro != intro;
}

/// A grey placeholder that shimmers while content loads. The shimmer stops
/// after about half a minute so a stuck request doesn't animate forever.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.height = 16, this.width, this.radius = 8});
  final double height;
  final double? width;
  final double radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_controller.isAnimating) return;
    if (VzMotion.of(context, VzMotion.wide) != Duration.zero) {
      _controller.repeat(count: 25);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final base = scheme.outline;
    final light = Color.lerp(base, scheme.surface, 0.6)!;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = _controller.value * 3 - 1;
        return Container(
          height: widget.height,
          width: widget.width,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.radius),
            gradient: LinearGradient(
              begin: Alignment(t - 1, 0),
              end: Alignment(t + 1, 0),
              colors: [base, light, base],
            ),
          ),
        );
      },
    );
  }
}

/// Cards of placeholders, for a list that is still loading.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 3});
  final int count;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    shrinkWrap: true,
    physics: const NeverScrollableScrollPhysics(),
    children: [
      for (var i = 0; i < count; i++)
        const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: ShadCard(
            padding: EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Skeleton(height: 18, width: 180),
                SizedBox(height: 12),
                Skeleton(width: 120),
                SizedBox(height: 8),
                Skeleton(),
                SizedBox(height: 8),
                Skeleton(width: 220),
              ],
            ),
          ),
        ),
    ],
  );
}

/// A message that drops in from the top with a bounce, then leaves on its
/// own. Replaces the snack bar for good news.
void showVzToast(
  BuildContext context,
  String message, {
  IconData icon = Icons.check_circle_rounded,
}) {
  final overlay = Overlay.maybeOf(context, rootOverlay: true);
  if (overlay == null) return;
  late final OverlayEntry entry;
  entry = OverlayEntry(
    builder: (_) =>
        _Toast(message: message, icon: icon, onDone: () => entry.remove()),
  );
  overlay.insert(entry);
}

class _Toast extends StatefulWidget {
  const _Toast({
    required this.message,
    required this.icon,
    required this.onDone,
  });
  final String message;
  final IconData icon;
  final VoidCallback onDone;

  @override
  State<_Toast> createState() => _ToastState();
}

class _ToastState extends State<_Toast> with SingleTickerProviderStateMixin {
  // In, a pause long enough to read, out: one controller, no timer.
  late final _controller =
      AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 3200),
      )..addStatusListener((s) {
        if (s == AnimationStatus.completed) widget.onDone();
      });

  @override
  void initState() {
    super.initState();
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final still = VzMotion.of(context, VzMotion.wide) == Duration.zero;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Positioned(
      top: MediaQuery.paddingOf(context).top + 12,
      left: 16,
      right: 16,
      child: IgnorePointer(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            final v = _controller.value;
            final enter = still
                ? 1.0
                : VzMotion.spring.transform((v / 0.2).clamp(0.0, 1.0));
            final leave = Curves.easeIn.transform(
              ((v - 0.88) / 0.12).clamp(0.0, 1.0),
            );
            return Opacity(
              opacity: (1 - leave) * (still ? 1 : enter.clamp(0.0, 1.0)),
              child: Transform.translate(
                offset: Offset(0, -80 * (1 - enter) - 40 * leave),
                child: child,
              ),
            );
          },
          child: Material(
            color: dark ? Colors.white : VzColors.ink,
            elevation: 6,
            shadowColor: Colors.black38,
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  Icon(widget.icon, color: VzColors.paid),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      widget.message,
                      style: TextStyle(
                        color: dark ? VzColors.ink : Colors.white,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
