import { DurableObject } from "cloudflare:workers";
import { ProtoMessageFetchResult, WebcastChatMessage, WebcastPushFrame } from "tiktok-live-proto/v3";
import type { Env } from "./env";

/**
 * One instance per running TikTok live. It holds the WebSocket to TikTok for
 * the hours the live lasts and keeps the comments in its own SQLite storage.
 *
 * tiktok-live-connector, used by backend/src/live, does not load in Workers
 * (its HTTP client needs Node's net and http2 internals). What it does on top
 * of the protocol is small: sign the URL (an Euler API call, plain fetch),
 * open a WebSocket and decode protobuf frames. The decoding library it uses,
 * tiktok-live-proto, runs here; the WebSocket is the Workers one.
 */
export class LiveReader extends DurableObject<Env> {
  private socket: WebSocket | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS comment (id TEXT PRIMARY KEY, user TEXT, nickname TEXT, text TEXT, at INTEGER)`,
    );
  }

  /** Opens the signed TikTok WebSocket URL (from the sign API) and listens. */
  async listen(signedUrl: string, cookie: string) {
    const res = await fetch(signedUrl, { headers: { Upgrade: "websocket", Cookie: cookie } });
    const ws = res.webSocket;
    if (!ws) throw new Error(`TikTok refused the WebSocket: ${res.status}`);
    ws.accept();
    ws.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) void this.handleFrame(new Uint8Array(event.data));
    });
    this.socket = ws;
    return { state: "connected" };
  }

  stop() {
    this.socket?.close(1000, "stop");
    this.socket = null;
  }

  /** Decodes one push frame and stores the chat messages it carries. */
  async handleFrame(bytes: Uint8Array) {
    const frame = WebcastPushFrame.decode(bytes);
    if (frame.payloadType !== "msg") return 0;
    const gzip =
      frame.payloadEncoding === "gzip" ||
      frame.headers.some((h) => h.key === "compress_type" && h.value === "gzip");
    const payload = gzip ? await gunzip(frame.payload) : frame.payload;
    const result = ProtoMessageFetchResult.decode(payload);
    let stored = 0;
    for (const message of result.messages) {
      if (message.method !== "WebcastChatMessage") continue;
      const chat = WebcastChatMessage.decode(message.payload);
      const user = chat.user?.displayId || "inconnu";
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO comment VALUES (?, ?, ?, ?, ?)`,
        message.msgId || crypto.randomUUID(),
        user,
        chat.user?.nickname || user,
        chat.content,
        Date.now(),
      );
      stored++;
    }
    return stored;
  }

  comments(limit = 50) {
    return this.ctx.storage.sql
      .exec(`SELECT id, user, nickname, text, at FROM comment ORDER BY at DESC LIMIT ?`, limit)
      .toArray();
  }
}

async function gunzip(data: Uint8Array) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
