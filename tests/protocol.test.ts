import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  aad,
  base64url,
  decrypt,
  encrypt,
  hashAccess,
  inviteURL,
  message,
  parseInvite,
  randomSecret,
  unbase64url,
  validateEnvelope,
} from "../packages/protocol/src/index.ts";
import { createRoom, RoomClient } from "../packages/protocol/src/client.ts";
import vector from "./vectors/aes-gcm.json";
const room = "AAAAAAAAAAAAAAAAAAAAAA";
describe("protocol and independent crypto", () => {
  it("decrypts a fixed Python AES-GCM vector with exact UTF-8 AAD", async () => {
    expect(await decrypt(vector.room_id, vector.key, vector.envelope)).toEqual(
      vector.payload,
    );
    expect(
      new TextDecoder().decode(aad(vector.room_id, vector.envelope.event_id)),
    ).toBe(vector.aad);
  });
  it("Python independently decrypts a fresh reference-client ciphertext", async () => {
    const key = randomSecret(),
      input = message("Unicode: Grüße 🌱 <script>not code</script>", "Alex");
    const envelope = await encrypt(room, key, input);
    const payload = await decrypt(room, key, envelope);
    const result = execFileSync(
      "python3",
      ["tests/vectors/check.py", "--event"],
      {
        input: JSON.stringify({ room_id: room, key, payload, envelope }),
        encoding: "utf8",
      },
    );
    expect(JSON.parse(result)).toEqual(payload);
    expect(await decrypt(room, key, envelope)).toEqual(payload);
  });
  it("rejects wrong keys, altered bytes, room IDs and event IDs", async () => {
    const { key, envelope, room_id } = vector;
    await expect(decrypt(room_id, randomSecret(), envelope)).rejects.toThrow(
      "Cannot decrypt",
    );
    const bytes = unbase64url(envelope.ciphertext);
    bytes[0] ^= 1;
    await expect(
      decrypt(room_id, key, { ...envelope, ciphertext: base64url(bytes) }),
    ).rejects.toThrow();
    await expect(
      decrypt("BAAAAAAAAAAAAAAAAAAAAA", key, envelope),
    ).rejects.toThrow();
    await expect(
      decrypt(room_id, key, { ...envelope, event_id: crypto.randomUUID() }),
    ).rejects.toThrow();
  });
  it("uses fresh nonces/event IDs and authenticates a complete payload", async () => {
    const key = randomSecret(),
      a = await encrypt(room, key, message("one")),
      b = await encrypt(room, key, message("one"));
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.event_id).not.toBe(b.event_id);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it("rejects malformed/cross-origin-secret URLs and noncanonical base64", () => {
    const url = inviteURL({
      origin: "https://example.com",
      roomId: room,
      key: randomSecret(),
      access: randomSecret(),
    });
    expect(parseInvite(url).roomId).toBe(room);
    for (const value of [
      url.replace("#", "?"),
      url + "&k=bad",
      url.replace("https:", "http:"),
      url.replace("/r/", "/bad/"),
      url.replace("https://", "https://user:pass@"),
    ])
      expect(() => parseInvite(value)).toThrow();
    for (const value of ["", "AA==", "A", "AB", "!"])
      expect(() => unbase64url(value)).toThrow();
    expect(() =>
      validateEnvelope({ ...vector.envelope, actor: "plaintext" }),
    ).toThrow();
    expect(() =>
      validateEnvelope({ ...vector.envelope, nonce: randomSecret() }),
    ).toThrow();
  });
  it("does not send K or invitation fragments over HTTP", async () => {
    const requests: { url: string; init: any }[] = [];
    const transport = vi.fn(async (url: any, init: any) => {
      requests.push({
        url: String(url),
        init: {
          ...init,
          headers: Object.fromEntries(new Headers(init.headers)),
        },
      });
      if (String(url).endsWith("/rooms"))
        return Response.json(
          { room_id: room, expires_at: "2030-01-01T00:00:00Z" },
          { status: 201 },
        );
      return Response.json({ seq: 1, event_id: vector.envelope.event_id });
    }) as unknown as typeof fetch;
    const created = await createRoom("https://example.com", 14, transport);
    await new RoomClient(created.invite, transport).publish(
      "CANARY_PRIVATE_BODY",
      "CANARY_PRIVATE_ACTOR",
    );
    const serialized = JSON.stringify(requests);
    for (const secret of [
      created.invite.key,
      created.url,
      "CANARY_PRIVATE_BODY",
      "CANARY_PRIVATE_ACTOR",
    ])
      expect(serialized).not.toContain(secret);
    expect(requests[0].init.body).toContain(
      await hashAccess(created.invite.access),
    );
    expect(requests[0].init.body).not.toContain(created.invite.access);
  });
  it("retries the exact encrypted POST bytes after an ambiguous network result", async () => {
    const calls: string[] = [];
    const transport = vi.fn(async (_url: any, init: any) => {
      calls.push(init.body);
      if (calls.length === 1) throw new Error("network");
      return Response.json({ seq: 1, event_id: vector.envelope.event_id });
    }) as unknown as typeof fetch;
    const invite = {
      origin: "https://example.com",
      roomId: room,
      key: randomSecret(),
      access: randomSecret(),
    };
    await new RoomClient(invite, transport).publish("retry");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
  });
  it("surfaces decryption failures and refuses a nonadvancing page", async () => {
    const invite = {
      origin: "https://example.com",
      roomId: room,
      key: randomSecret(),
      access: randomSecret(),
    };
    const transport = vi.fn(async () =>
      Response.json({
        events: [{ ...vector.envelope, seq: 1 }],
        next_after: 1,
        has_more: false,
      }),
    ) as unknown as typeof fetch;
    const result = await new RoomClient(invite, transport).read();
    expect(result.events[0].error).toBeTruthy();
    expect(result.events[0].payload).toBeUndefined();
    const stuck = vi.fn(async () =>
      Response.json({ events: [], next_after: 0, has_more: true }),
    ) as unknown as typeof fetch;
    await expect(new RoomClient(invite, stuck).read()).rejects.toThrow(
      "invalid event page",
    );
  });
});
