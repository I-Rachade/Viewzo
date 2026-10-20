import { randomInt } from 'node:crypto';
import type { CartLine } from './intent';

// Order lines and product matching, ported from TackTack (src/store.js).

export interface CartItem {
  productId: string | null;
  name: string;
  variant: string | null;
  quantity: number;
  unitPrice: number | null;
}

export interface ProductRef {
  id: string;
  name: string;
  price: number;
}

export const normalize = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const stem = (w: string) => w.replace(/s$/, '');

/** Finds the product a comment refers to from the AI's (or the buyer's) words. */
export function matchProduct<P extends ProductRef>(
  products: P[],
  words: string,
): P | null {
  const wanted = normalize(words);
  if (!wanted) return null;
  const exact = products.find((p) => normalize(p.name) === wanted);
  if (exact) return exact;
  const set = new Set(wanted.split(' ').map(stem));
  let best: P | null = null;
  let bestScore = 0;
  for (const p of products) {
    const pWords = normalize(p.name).split(' ').map(stem);
    const score =
      pWords.filter((w) => w.length > 1 && set.has(w)).length / pWords.length;
    if (score > bestScore) [best, bestScore] = [p, score];
  }
  return bestScore >= 0.5 ? best : null;
}

/** Keyword mode: "je prends 2 pagnes" gives 2, but "taille 42" gives nothing. */
export function guessQuantity(text: string, productName: string) {
  const productWords = new Set(normalize(productName).split(' ').map(stem));
  for (const m of normalize(text).matchAll(/\b(\d{1,2}) ([a-z]+)/g)) {
    if (productWords.has(stem(m[2]))) return Number(m[1]);
  }
  return null;
}

/** Turns the AI's cart into order lines with the seller's prices. */
export function toItems(cart: CartLine[], products: ProductRef[]): CartItem[] {
  const items: CartItem[] = [];
  for (const line of cart) {
    const product =
      products.find((p) => p.id === line.product_id) ??
      matchProduct(products, line.product);
    const quantity =
      Number.isInteger(line.quantity) && line.quantity > 0
        ? Math.min(line.quantity, 999)
        : 1;
    const variant = line.variant?.trim().slice(0, 60) || null;
    const name =
      product?.name ??
      String(line.product ?? '')
        .trim()
        .slice(0, 120);
    if (!name) continue;
    const same = items.find((i) => i.name === name && i.variant === variant);
    if (same) same.quantity += quantity;
    else
      items.push({
        productId: product?.id ?? null,
        name,
        variant,
        quantity,
        unitPrice: product?.price ?? null,
      });
  }
  return items;
}

/** Sum of the priced lines, or null when no line has a price. */
export function cartTotal(items: CartItem[]) {
  const priced = items.filter((i) => i.unitPrice != null);
  return priced.length
    ? priced.reduce((sum, i) => sum + i.unitPrice! * i.quantity, 0)
    : null;
}

// No 0/O or 1/I, so a code read out in a live is not misheard.
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Order code the customer sends on WhatsApp, e.g. VZ7K3M. */
export function newLeadCode() {
  let code = 'VZ';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}
