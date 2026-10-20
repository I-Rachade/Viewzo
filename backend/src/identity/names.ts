/** Lower case words of a name, without accents or punctuation. */
export function nameWords(name: string) {
  return new Set(
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 2),
  );
}

/**
 * Whether the Mobile Money holder looks like the verified person: order,
 * accents and case don't matter, and a missing middle name is fine. At least
 * two words must agree (one when a name has only one word).
 */
export function namesMatch(a: string, b: string) {
  const x = nameWords(a);
  const y = nameWords(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared >= Math.min(2, x.size, y.size);
}
