import 'dart:math' as math;

import 'package:flutter/material.dart';

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
