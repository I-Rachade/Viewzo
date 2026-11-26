import { env } from "cloudflare:test";
import {
  BaseProtoMessage,
  ProtoMessageFetchResult,
  User,
  WebcastChatMessage,
  WebcastPushFrame,
} from "tiktok-live-proto/v3";
import { expect, it } from "vitest";
import type { LiveReader } from "../src/live";

// ts-proto messages need every field; start from the decoded empty message.
function make<T>(type: { decode(b: Uint8Array): T }, fields: Partial<T>): T {
  return { ...type.decode(new Uint8Array()), ...fields };
}

async function gzip(data: Uint8Array) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

it("a Durable Object decodes TikTok frames and keeps the comments", async () => {
  const chat = WebcastChatMessage.encode(
    make(WebcastChatMessage, {
      content: "Je prends le sac rouge",
      user: make(User, { displayId: "ama.tg", nickname: "Ama" }),
    }),
  ).finish();
  const result = ProtoMessageFetchResult.encode(
    make(ProtoMessageFetchResult, {
      messages: [make(BaseProtoMessage, { method: "WebcastChatMessage", msgId: "7300000000000000001", payload: Buffer.from(chat) })],
    }),
  ).finish();
  const frame = WebcastPushFrame.encode(
    make(WebcastPushFrame, { payloadType: "msg", payloadEncoding: "gzip", payload: Buffer.from(await gzip(result)) }),
  ).finish();

  const stub = env.LIVE_READER.get(env.LIVE_READER.idFromName("live-1")) as DurableObjectStub<LiveReader>;
  expect(await stub.handleFrame(frame)).toBe(1);
  // The same frame twice keeps one comment.
  await stub.handleFrame(frame);
  const comments = await stub.comments();
  expect(comments).toHaveLength(1);
  expect(comments[0]).toMatchObject({ user: "ama.tg", nickname: "Ama", text: "Je prends le sac rouge" });
});
