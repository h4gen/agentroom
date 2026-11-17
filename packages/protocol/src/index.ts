// The only crypto implementation used by the browser and the Node reference client.
export const PROTOCOL = 1;
export const MAX_EVENT_BYTES = 65_536;
export const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;
export const EVENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();
export interface Message {
  v: 1;
  type: "message";
  actor: string;
  body: string;
  reply_to: string | null;
  client_created_at: string;
}
export interface Envelope {
  event_id: string;
  nonce: string;
  ciphertext: string;
}
export interface StoredEvent extends Envelope {
  seq: number;
}
export interface Invite {
  origin: string;
  roomId: string;
  key: string;
  access: string;
}
export class ProtocolError extends Error {}
export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unbase64url(
  value: unknown,
  length?: number,
): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new ProtocolError("Invalid base64url.");
  let result: Uint8Array<ArrayBuffer>;
  try {
    result = Uint8Array.from(
      atob(value.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
  } catch {
    throw new ProtocolError("Invalid base64url.");
  }
  if (
    base64url(result) !== value ||
    (length !== undefined && result.length !== length)
  )
    throw new ProtocolError("Invalid base64url length or encoding.");
  return result;
}
export function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export async function hashAccess(access: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", unbase64url(access, 32)),
    ),
  );
}
export function validOrigin(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new ProtocolError(
      "Use an HTTPS origin (HTTP is allowed only on localhost).",
    );
  return url.origin;
}
export function parseInvite(value: string): Invite {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ProtocolError("A full invitation URL is required.");
  }
  const origin = validOrigin(url.origin);
  const match = /^\/r\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
  if (!match || url.search || url.username || url.password)
    throw new ProtocolError("Invalid invitation URL.");
  const params = new URLSearchParams(url.hash.slice(1));
  if (
    params.size !== 2 ||
    params.getAll("k").length !== 1 ||
    params.getAll("a").length !== 1
  )
    throw new ProtocolError(
      "Keep the complete invitation link, including #k=…&a=….",
    );
  const key = params.get("k") ?? "",
    access = params.get("a") ?? "";
  unbase64url(key, 32);
  unbase64url(access, 32);
  return { origin, roomId: match[1], key, access };
}
export function inviteURL(invite: Invite): string {
  const value = `${invite.origin}/r/${invite.roomId}#k=${invite.key}&a=${invite.access}`;
  parseInvite(value);
  return value;
}
export function message(
  body: string,
  actor = "Anonymous",
  reply_to: string | null = null,
): Message {
  const value: Message = {
    v: 1,
    type: "message",
    actor,
    body,
    reply_to,
    client_created_at: new Date().toISOString(),
  };
  validateMessage(value);
  return value;
}
export function validateMessage(value: unknown): asserts value is Message {
  const m = value as Message;
  if (
    !m ||
    m.v !== 1 ||
    m.type !== "message" ||
    typeof m.actor !== "string" ||
    m.actor.length > 120 ||
    typeof m.body !== "string" ||
    (m.reply_to !== null &&
      (typeof m.reply_to !== "string" || !EVENT_ID.test(m.reply_to))) ||
    typeof m.client_created_at !== "string" ||
    !Number.isFinite(Date.parse(m.client_created_at))
  )
    throw new ProtocolError("Unsupported or invalid decrypted message.");
}
export function validateEnvelope(value: unknown): asserts value is Envelope {
  const e = value as Envelope;
  if (
    !e ||
    typeof e.event_id !== "string" ||
    !EVENT_ID.test(e.event_id) ||
    Object.keys(e).sort().join(",") !== "ciphertext,event_id,nonce"
  )
    throw new ProtocolError("Invalid event envelope.");
  unbase64url(e.nonce, 12);
  const bytes = unbase64url(e.ciphertext);
  if (bytes.length < 16)
    throw new ProtocolError("Ciphertext is missing its authentication tag.");
  if (bytes.length > MAX_EVENT_BYTES)
    throw new ProtocolError("Event exceeds 64 KiB.");
}
export function aad(roomId: string, eventId: string): Uint8Array<ArrayBuffer> {
  if (!ROOM_ID.test(roomId) || !EVENT_ID.test(eventId))
    throw new ProtocolError("Invalid room or event ID.");
  return new Uint8Array(
    encoder.encode(`agentroom/v1|event|${roomId}|${eventId}`),
  );
}
export async function encrypt(
  roomId: string,
  key: string,
  payload: Message,
): Promise<Envelope> {
  validateMessage(payload);
  const event_id = crypto.randomUUID(),
    nonce = crypto.getRandomValues(new Uint8Array(12));
  const secret = await crypto.subtle.importKey(
    "raw",
    unbase64url(key, 32),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad(roomId, event_id),
      tagLength: 128,
    },
    secret,
    encoder.encode(JSON.stringify(payload)),
  );
  const result = {
    event_id,
    nonce: base64url(nonce),
    ciphertext: base64url(new Uint8Array(ciphertext)),
  };
  validateEnvelope(result);
  return result;
}
export async function decrypt(
  roomId: string,
  key: string,
  event: Envelope,
): Promise<Message> {
  validateEnvelope({
    event_id: event.event_id,
    nonce: event.nonce,
    ciphertext: event.ciphertext,
  });
  const secret = await crypto.subtle.importKey(
    "raw",
    unbase64url(key, 32),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unbase64url(event.nonce, 12),
        additionalData: aad(roomId, event.event_id),
        tagLength: 128,
      },
      secret,
      unbase64url(event.ciphertext),
    );
  } catch {
    throw new ProtocolError(
      "Cannot decrypt event: wrong key or altered ciphertext/AAD.",
    );
  }
  let result: unknown;
  try {
    result = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        plaintext,
      ),
    );
  } catch {
    throw new ProtocolError("Invalid decrypted JSON.");
  }
  validateMessage(result);
  return result;
}
