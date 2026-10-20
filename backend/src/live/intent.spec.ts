import {
  cartTotal,
  guessQuantity,
  matchProduct,
  newLeadCode,
  toItems,
} from './cart';
import { classifyByKeywords, IntentClassifier, maskPhones } from './intent';

const products = [
  { id: 'p1', name: 'Pagne wax', price: 5000 },
  { id: 'p2', name: 'Sac noir', price: 12000 },
];

describe('keyword intents', () => {
  it.each([
    ['Je prends 2 pagnes wax svp', 'achat'],
    ['Réserve-moi le grand modèle stp', 'achat'],
    ["C'est combien le sac noir ?", 'question_prix'],
    ['Vous livrez à Agoè ?', 'question_livraison'],
    ["c'est dispo en bleu ?", 'question_produit'],
    ['finalement non', 'annulation'],
    ['trop beau 😍😍', 'autre'],
  ])('%s → %s', (text, intent) => {
    expect(classifyByKeywords(text)).toBe(intent);
  });
});

describe('maskPhones', () => {
  it('hides numbers written in a comment', () => {
    expect(maskPhones('Je prends 1 pagne, mon WhatsApp 90 12 34 56')).toEqual({
      text: 'Je prends 1 pagne, mon WhatsApp [numéro masqué]',
      found: true,
    });
    expect(maskPhones('+228 90.12.34.56').text).toBe('[numéro masqué]');
  });

  it('keeps sizes and quantities', () => {
    expect(maskPhones('2 sacs taille 42')).toEqual({
      text: '2 sacs taille 42',
      found: false,
    });
  });
});

describe('carts', () => {
  it('matches products loosely and guesses quantities', () => {
    expect(matchProduct(products, 'je prends 2 pagnes')?.id).toBe('p1');
    expect(matchProduct(products, 'des chaussures')).toBeNull();
    expect(guessQuantity('je prends 2 pagnes', 'Pagne wax')).toBe(2);
    expect(guessQuantity('taille 42', 'Pagne wax')).toBeNull();
  });

  it('prices the AI cart and merges lines', () => {
    const items = toItems(
      [
        { product_id: 'p1', product: 'pagne', quantity: 2, variant: null },
        { product_id: null, product: 'Sac noir', quantity: 1, variant: 'L' },
        { product_id: 'p1', product: 'pagne', quantity: 1, variant: null },
        { product_id: null, product: 'Chapeau', quantity: 0, variant: null },
      ],
      products,
    );
    expect(items).toEqual([
      {
        productId: 'p1',
        name: 'Pagne wax',
        variant: null,
        quantity: 3,
        unitPrice: 5000,
      },
      {
        productId: 'p2',
        name: 'Sac noir',
        variant: 'L',
        quantity: 1,
        unitPrice: 12000,
      },
      {
        productId: null,
        name: 'Chapeau',
        variant: null,
        quantity: 1,
        unitPrice: null,
      },
    ]);
    expect(cartTotal(items)).toBe(27000);
    expect(cartTotal([])).toBeNull();
  });

  it('makes codes that are easy to read out', () => {
    for (let i = 0; i < 50; i++) {
      expect(newLeadCode()).toMatch(/^VZ[2-9A-HJ-NP-Z]{4}$/);
    }
  });
});

describe('IntentClassifier', () => {
  it('falls back to keywords without an API key, in order', async () => {
    const seen: string[] = [];
    const c = new IntentClassifier({
      client: null,
      model: 'x',
      getCatalog: () => Promise.resolve([]),
      getCustomers: () => Promise.resolve([]),
      onResult: (comment, r) => {
        seen.push(`${comment.id}:${r.intent}:${r.by}`);
        return Promise.resolve();
      },
    });
    c.add({ id: '1', user: 'a', nickname: 'a', text: 'je prends', at: 1 });
    c.add({ id: '2', user: 'b', nickname: 'b', text: 'bravo', at: 2 });
    await c.stop();
    expect(seen).toEqual(['1:achat:mots-clés', '2:autre:mots-clés']);
  });

  it('uses keywords when the AI call fails', async () => {
    const errors: unknown[] = [];
    const seen: string[] = [];
    const client = {
      beta: {
        messages: { create: () => Promise.reject(new Error('down')) },
      },
    };
    const c = new IntentClassifier({
      client: client as never,
      model: 'x',
      batchMs: 5,
      getCatalog: () => Promise.resolve([]),
      getCustomers: () => Promise.resolve([]),
      onResult: (_, r) => {
        seen.push(r.by);
        return Promise.resolve();
      },
      onError: (e) => errors.push(e),
    });
    c.add({ id: '1', user: 'a', nickname: 'a', text: 'combien ?', at: 1 });
    await c.stop();
    expect(seen).toEqual(['mots-clés']);
    expect(errors).toHaveLength(1);
  });

  it('reads the AI answer', async () => {
    const client = {
      beta: {
        messages: {
          create: () =>
            Promise.resolve({
              stop_reason: 'end_turn',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    results: [
                      {
                        id: '1',
                        intent: 'achat',
                        cart_changed: true,
                        cart: [
                          {
                            product_id: 'p1',
                            product: 'pagne',
                            quantity: 2,
                            variant: null,
                          },
                        ],
                        reply: null,
                      },
                    ],
                  }),
                },
              ],
            }),
        },
      },
    };
    const results: unknown[] = [];
    const c = new IntentClassifier({
      client: client as never,
      model: 'x',
      batchMs: 5,
      getCatalog: () => Promise.resolve([]),
      getCustomers: () => Promise.resolve([]),
      onResult: (_, r) => {
        results.push(r);
        return Promise.resolve();
      },
    });
    c.add({ id: '1', user: 'a', nickname: 'a', text: 'moi aussi', at: 1 });
    await c.stop();
    expect(results).toEqual([
      {
        id: '1',
        intent: 'achat',
        cart: [
          { product_id: 'p1', product: 'pagne', quantity: 2, variant: null },
        ],
        reply: null,
        by: 'IA',
      },
    ]);
  });
});
