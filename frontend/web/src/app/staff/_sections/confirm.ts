// Asks before a decision that moves money or can't be undone.
export function confirmed(message: string) {
  return window.confirm(message);
}
