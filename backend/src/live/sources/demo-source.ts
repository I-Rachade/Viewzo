import { EventEmitter } from 'node:events';
import type { CommentSource } from './source';

// Simulated live to try the module without TikTok (from TackTack).
const SAMPLE: [string, string][] = [
  ['ama_lome', 'Bonsoir tout le monde 👋'],
  ['kossi.tg', "C'est combien le sac noir ?"],
  ['edem228', 'Je prends 2 pagnes wax svp'],
  ['afi_b', 'trop beau 😍😍'],
  ['yao_kpalime', 'Vous livrez à Agoè ?'],
  ['mawuli', 'moi je veux les chaussures taille 42'],
  ['sena.k', '🔥🔥🔥'],
  ['dzifa', 'Le prix des savons svp'],
  ['komla_99', 'Salut de Bè !'],
  ['akpene', 'je commande 1 sac rouge, comment payer ?'],
  ['essi', "c'est dispo en bleu ?"],
  ['kodjo', 'On peut payer par Flooz ?'],
  ['abla.tg', 'ça dure combien de temps la livraison ?'],
  ['selom', 'Bravo pour le live'],
  ['enyonam', 'Réserve-moi le grand modèle stp'],
  ['kafui', 'Je prends 1 pagne, mon WhatsApp 90 12 34 56'],
];

export class DemoSource extends EventEmitter implements CommentSource {
  private timer: NodeJS.Timeout | null = null;
  private i = 0;

  constructor(private readonly intervalMs = 1800) {
    super();
  }

  start() {
    this.emit('status', {
      state: 'connected',
      message: 'Mode démo : live simulé.',
    });
    this.emit('viewers', 87);
    this.timer = setInterval(() => {
      if (this.i >= SAMPLE.length) {
        this.stop();
        this.emit('status', { state: 'ended', message: 'Démo terminée.' });
        return;
      }
      const [user, text] = SAMPLE[this.i];
      this.i += 1;
      this.emit('comment', {
        id: `demo-${this.i}`,
        user,
        nickname: user,
        text,
        at: Date.now(),
      });
    }, this.intervalMs);
    return Promise.resolve();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
