import { EventEmitter } from 'node:events';
import type { CommentSource } from './source';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

/**
 * Reads the comments of a running TikTok live by the seller's username.
 * TikTok has no official API for this; tiktok-live-connector is an
 * unofficial client (ported from TackTack, src/sources/tiktok.js).
 */
export class TikTokSource extends EventEmitter implements CommentSource {
  private connection: any = null;

  constructor(
    private readonly username: string,
    private readonly signApiKey?: string,
  ) {
    super();
  }

  async start() {
    // ES module: loaded only when a real live starts.
    const lib: any = await import('tiktok-live-connector');
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
    const c = new TikTokLiveConnection(this.username, {
      signApiKey: this.signApiKey || undefined,
    });
    this.connection = c;
    c.on(WebcastEvent.CHAT, (data: any) => {
      // Field names differ between proto versions.
      const user = data.user?.displayId || data.user?.uniqueId || 'inconnu';
      this.emit('comment', {
        id: String(data.common?.msgId || `${Date.now()}-${Math.random()}`),
        user: String(user),
        nickname: String(data.user?.nickname || user),
        text: String(data.content ?? data.comment ?? ''),
        at: Date.now(),
      });
    });
    c.on(WebcastEvent.ROOM_USER, (data: any) => {
      const viewers = Number(data.viewerCount ?? data.total);
      if (Number.isFinite(viewers)) this.emit('viewers', viewers);
    });
    c.on(WebcastEvent.STREAM_END, () =>
      this.emit('status', { state: 'ended', message: 'Le live est terminé.' }),
    );
    c.on(ControlEvent.DISCONNECTED, () =>
      this.emit('status', {
        state: 'disconnected',
        message: 'Déconnecté du live.',
      }),
    );
    await c.connect();
    this.emit('status', {
      state: 'connected',
      message: `Connecté au live de @${this.username}.`,
    });
  }

  stop() {
    try {
      this.connection?.disconnect();
    } catch {
      // already disconnected
    }
  }
}
