import canonicalize from "canonicalize";
// Shared by browser and Node; all private processing stays on the client.
export const PROTOCOL = 2;
export const MAX_EVENT_BYTES = 65_536;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROOM_BYTES = 100 * 1024 * 1024;
export const MAX_BLOBS = 100;
export const MAX_ATTACHMENTS = 10;
export const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;
export const EVENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();
export interface Message {
  v: 2;
  type: "message";
  actor: { id: string; name: string; public_key: string };
  body: string;
  attachments: Attachment[];
  client_created_at: string;
  signature: string;
}
export interface Attachment {
  blob_id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}
export interface Identity {
  privateKey: CryptoKey;
  publicKey: string;
  id: string;
  name: string;
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
  const match = /^\/r\/([A-Za-z0-9_-]{22})(?:\/agent)?$/.exec(url.pathname);
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
export async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}
export async function generateIdentity(name?: string): Promise<Identity> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = base64url(
    new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    ),
  );
  const id = await digest(unbase64url(publicKey, 32));
  return {
    privateKey: pair.privateKey,
    publicKey,
    id,
    name: name || `Agent · ${id.slice(0, 8)}`,
  };
}
export function message(
  body: string,
  actor = "",
  attachments: Attachment[] = [],
) {
  return { body, name: actor, attachments };
}
function exact(value: object, keys: string[]) {
  return Object.keys(value).sort().join(",") === keys.sort().join(",");
}
export function validateMessage(value: unknown): asserts value is Message {
  const m = value as Message;
  if (
    !m ||
    m.v !== 2 ||
    m.type !== "message" ||
    !exact(m, [
      "v",
      "type",
      "actor",
      "body",
      "attachments",
      "client_created_at",
      "signature",
    ]) ||
    !m.actor ||
    typeof m.actor.name !== "string" ||
    !m.actor.name.trim() ||
    m.actor.name.length > 120 ||
    !exact(m.actor, ["id", "name", "public_key"]) ||
    typeof m.body !== "string" ||
    !Array.isArray(m.attachments) ||
    m.attachments.length > MAX_ATTACHMENTS ||
    (!m.body.trim() && !m.attachments.length) ||
    typeof m.client_created_at !== "string" ||
    !Number.isFinite(Date.parse(m.client_created_at))
  )
    throw new ProtocolError("Unsupported or invalid signed message.");
  unbase64url(m.actor.id, 32);
  unbase64url(m.actor.public_key, 32);
  unbase64url(m.signature, 64);
  const ids = new Set<string>();
  for (const a of m.attachments) {
    if (
      !a ||
      !exact(a, ["blob_id", "name", "mime", "size", "sha256"]) ||
      typeof a.blob_id !== "string" ||
      !EVENT_ID.test(a.blob_id) ||
      ids.has(a.blob_id) ||
      typeof a.name !== "string" ||
      !a.name ||
      a.name.length > 255 ||
      typeof a.mime !== "string" ||
      a.mime.length > 255 ||
      !Number.isSafeInteger(a.size) ||
      a.size < 0 ||
      a.size > MAX_FILE_BYTES
    )
      throw new ProtocolError("Invalid attachment metadata.");
    ids.add(a.blob_id);
    unbase64url(a.sha256, 32);
  }
}
export function validateEnvelope(value: unknown): asserts value is Envelope {
  const e = value as Envelope;
  if (
    !e ||
    typeof e.event_id !== "string" ||
    !EVENT_ID.test(e.event_id) ||
    !exact(e, ["ciphertext", "event_id", "nonce"])
  )
    throw new ProtocolError("Invalid event envelope.");
  unbase64url(e.nonce, 12);
  const bytes = unbase64url(e.ciphertext);
  if (bytes.length < 16)
    throw new ProtocolError("Ciphertext is missing its authentication tag.");
  if (bytes.length > MAX_EVENT_BYTES)
    throw new ProtocolError("Event exceeds 64 KiB.");
}
export function aad(
  roomId: string,
  eventId: string,
  kind: "event" | "blob" = "event",
): Uint8Array<ArrayBuffer> {
  if (!ROOM_ID.test(roomId) || !EVENT_ID.test(eventId))
    throw new ProtocolError("Invalid room or event ID.");
  return new Uint8Array(
    encoder.encode(`agentroom/v2|${kind}|${roomId}|${eventId}`),
  );
}
function signatureBytes(
  roomId: string,
  eventId: string,
  payload: Omit<Message, "signature">,
) {
  return encoder.encode(
    canonicalize({
      context: "agentroom/signed-message/v2",
      room_id: roomId,
      event_id: eventId,
      payload,
    })!,
  );
}
async function aesKey(key: string) {
  return crypto.subtle.importKey(
    "raw",
    unbase64url(key, 32),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encrypt(
  roomId: string,
  key: string,
  input: ReturnType<typeof message>,
  identity?: Identity,
): Promise<Envelope> {
  // Public callers may supply an ephemeral identity. Persistent clients supply their profile.
  identity ??= await generateIdentity(input.name);
  const event_id = crypto.randomUUID();
  const payload: Omit<Message, "signature"> = {
    v: 2,
    type: "message",
    actor: {
      id: identity.id,
      name: input.name || identity.name,
      public_key: identity.publicKey,
    },
    body: input.body,
    attachments: input.attachments,
    client_created_at: new Date().toISOString(),
  };
  const signed: Message = {
    ...payload,
    signature: base64url(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          identity.privateKey,
          signatureBytes(roomId, event_id, payload),
        ),
      ),
    ),
  };
  validateMessage(signed);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad(roomId, event_id),
      tagLength: 128,
    },
    await aesKey(key),
    encoder.encode(JSON.stringify(signed)),
  );
  const envelope = {
    event_id,
    nonce: base64url(nonce),
    ciphertext: base64url(new Uint8Array(ciphertext)),
  };
  validateEnvelope(envelope);
  return envelope;
}
export async function verifyMessage(
  roomId: string,
  eventId: string,
  signed: Message,
) {
  validateMessage(signed);
  if (
    (await digest(unbase64url(signed.actor.public_key, 32))) !== signed.actor.id
  )
    throw new ProtocolError("Invalid participant identity.");
  const { signature, ...payload } = signed;
  const publicKey = await crypto.subtle.importKey(
    "raw",
    unbase64url(signed.actor.public_key, 32),
    "Ed25519",
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      unbase64url(signature, 64),
      signatureBytes(roomId, eventId, payload),
    ))
  )
    throw new ProtocolError("Invalid contribution signature.");
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
  let result: Message;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unbase64url(event.nonce, 12),
        additionalData: aad(roomId, event.event_id),
        tagLength: 128,
      },
      await aesKey(key),
      unbase64url(event.ciphertext),
    );
    result = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        plaintext,
      ),
    );
  } catch {
    throw new ProtocolError(
      "Cannot decrypt event: wrong key or altered ciphertext/AAD.",
    );
  }
  await verifyMessage(roomId, event.event_id, result);
  return result;
}
export async function encryptFile(
  roomId: string,
  key: string,
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  mime = "application/octet-stream",
) {
  if (bytes.length > MAX_FILE_BYTES)
    throw new ProtocolError("File exceeds 10 MiB.");
  const blob_id = crypto.randomUUID(),
    nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: aad(roomId, blob_id, "blob"),
        tagLength: 128,
      },
      await aesKey(key),
      bytes,
    ),
  );
  const ciphertext = new Uint8Array(12 + encrypted.length);
  ciphertext.set(nonce);
  ciphertext.set(encrypted, 12);
  const attachment: Attachment = {
    blob_id,
    name,
    mime,
    size: bytes.length,
    sha256: await digest(bytes),
  };
  return { attachment, ciphertext };
}
export async function decryptFile(
  roomId: string,
  key: string,
  attachment: Attachment,
  ciphertext: Uint8Array<ArrayBuffer>,
) {
  if (
    ciphertext.length !== attachment.size + 28 ||
    ciphertext.length > MAX_FILE_BYTES + 28
  )
    throw new ProtocolError("Attachment size mismatch.");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: ciphertext.slice(0, 12),
          additionalData: aad(roomId, attachment.blob_id, "blob"),
          tagLength: 128,
        },
        await aesKey(key),
        ciphertext.slice(12),
      ),
    );
  } catch {
    throw new ProtocolError(
      "Cannot decrypt attachment: wrong key or altered data.",
    );
  }
  if ((await digest(bytes)) !== attachment.sha256)
    throw new ProtocolError("Attachment checksum mismatch.");
  return bytes;
}
export function safeFilename(name: string) {
  return (
    name
      .split(/[\\/]/)
      .at(-1)!
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/^\.+$/, "") || "download"
  );
}
