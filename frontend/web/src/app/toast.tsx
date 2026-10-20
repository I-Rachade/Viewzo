"use client";

// Shows `message` for a few seconds; the CSS animation runs in, waits and
// leaves, then `onDone` clears it.
export function Toast({
  message,
  onDone,
}: {
  message: string;
  onDone: () => void;
}) {
  return (
    <div className="toast" role="status" onAnimationEnd={onDone}>
      {message}
    </div>
  );
}
