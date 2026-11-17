import { DurableObject } from "cloudflare:workers";
import {
  base64url,
  hashAccess,
  MAX_EVENT_BYTES,
  ProtocolError,
  ROOM_ID,
  unbase64url,
  validateEnvelope,
} from "../../../packages/protocol/src/index.ts";
import protocolDoc from "../../../docs/PROTOCOL_V1.md";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
  CREATE_LIMIT: RateLimit;
  REQUEST_LIMIT: RateLimit;
}
type Meta = {
  protocol: number;
  access_hash: string;
  created_at: string;
  expires_at: string;
};
type EventRow = {
  seq: number;
  event_id: string;
  nonce: string;
  ciphertext: string;
  payload_digest: string;
};
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retry?: number,
  ) {
    super(message);
  }
}
const fail = (
  status: number,
  code: string,
  text: string,
  retry?: number,
): never => {
  throw new HttpError(status, code, text, retry);
};
function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return json(
      { error: { code: error.code, message: error.message } },
      error.status,
      error.retry === undefined ? {} : { "Retry-After": String(error.retry) },
    );
  if (error instanceof ProtocolError)
    return json(
      { error: { code: "INVALID_INPUT", message: error.message } },
      400,
    );
  // Never echo untrusted input or exception messages into logs or HTTP responses.
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Temporary relay error. Retry the same event.",
      },
    },
    500,
  );
}
async function body(
  request: Request,
  max = 90_000,
): Promise<{ raw: string; value: any }> {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  )
    fail(400, "INVALID_INPUT", "Use application/json.");
  if (Number(request.headers.get("Content-Length") ?? 0) > max)
    fail(413, "PAYLOAD_TOO_LARGE", "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "INVALID_INPUT", "JSON body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader!.cancel();
      fail(413, "PAYLOAD_TOO_LARGE", "Request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const raw = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
    return { raw, value: JSON.parse(raw) };
  } catch {
    return fail(400, "INVALID_INPUT", "Invalid JSON.");
  }
}
function secure(response: Response, api = false): Response {
  const result = new Response(response.body, response);
  const headers: Record<string, string> = {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Strict-Transport-Security": "max-age=31536000",
  };
  for (const [key, value] of Object.entries(headers))
    result.headers.set(key, value);
  if (api) result.headers.set("Cache-Control", "no-store");
  return result;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/protocol/v1" && request.method === "GET")
        return secure(
          new Response(protocolDoc, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            },
          }),
        );
      if (!url.pathname.startsWith("/v1/")) {
        if (!["GET", "HEAD"].includes(request.method))
          return secure(
            json(
              {
                error: {
                  code: "METHOD_NOT_ALLOWED",
                  message: "Method not allowed.",
                },
              },
              405,
            ),
          );
        // Explicit routes: API typos must never receive the SPA shell with a 200.
        if (
          url.pathname === "/" ||
          url.pathname === "/security" ||
          /^\/r\/[A-Za-z0-9_-]{22}$/.test(url.pathname)
        ) {
          const assetUrl = new URL("/index.html", url.origin);
          return secure(
            await env.ASSETS.fetch(
              new Request(assetUrl, {
                method: request.method,
                headers: request.headers,
              }),
            ),
            true,
          );
        }
        return secure(await env.ASSETS.fetch(request));
      }
      // Reject keys in query strings rather than silently accepting unsafe client implementations.
      if (url.searchParams.has("k") || url.searchParams.has("a"))
        fail(
          400,
          "INVALID_INPUT",
          "Secrets must never appear in query parameters.",
        );
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      if (!(await allowed(env.REQUEST_LIMIT, ip)))
        fail(
          429,
          "RATE_LIMITED",
          "Too many requests. Try again in a minute.",
          60,
        );
      if (url.pathname === "/v1/rooms" && request.method === "POST") {
        if (!(await allowed(env.CREATE_LIMIT, ip)))
          fail(
            429,
            "RATE_LIMITED",
            "Room creation limit reached. Try again in a minute.",
            60,
          );
        const { value } = await body(request, 1024);
        if (!value || value.protocol !== 1)
          fail(409, "UNSUPPORTED_PROTOCOL", "Only protocol 1 is supported.");
        if (
          Object.keys(value).some(
            (k) => !["protocol", "access_hash", "ttl_days"].includes(k),
          )
        )
          fail(400, "INVALID_INPUT", "Unexpected room fields.");
        unbase64url(value.access_hash, 32);
        const ttl = value.ttl_days ?? 14;
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > 30)
          fail(
            400,
            "INVALID_INPUT",
            "ttl_days must be an integer from 1 to 30.",
          );
        const room_id = base64url(crypto.getRandomValues(new Uint8Array(16)));
        const created_at = new Date().toISOString(),
          expires_at = new Date(Date.now() + ttl * 86_400_000).toISOString();
        const room = env.ROOMS.get(env.ROOMS.idFromName(room_id));
        await room.initialize({
          protocol: 1,
          access_hash: value.access_hash,
          created_at,
          expires_at,
        });
        return secure(
          json({ room_id, protocol: 1, created_at, expires_at }, 201),
          true,
        );
      }
      const match = /^\/v1\/rooms\/([A-Za-z0-9_-]{22})(\/events)?$/.exec(
        url.pathname,
      );
      if (!match || !ROOM_ID.test(match[1]))
        fail(404, "NOT_FOUND", "Room or route not found.");
      const auth = request.headers.get("Authorization");
      if (!auth) fail(401, "UNAUTHORIZED", "A room capability is required.");
      if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth!))
        fail(403, "FORBIDDEN", "Invalid capability.");
      return secure(
        await env.ROOMS.get(env.ROOMS.idFromName(match![1])).fetch(request),
        true,
      );
    } catch (error) {
      return secure(errorResponse(error), true);
    }
  },
} satisfies ExportedHandler<Env>;
async function allowed(limiter: RateLimit, key: string) {
  return (await limiter.limit({ key })).success;
}

export class Room extends DurableObject<Env> {
  async initialize(meta: Meta) {
    // Only room creation creates tables: GETs for random room IDs do not allocate persistent data.
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS room_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), protocol INTEGER NOT NULL, access_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS room_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, payload_digest TEXT NOT NULL, stored_at TEXT NOT NULL)`,
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS write_limits (singleton INTEGER PRIMARY KEY CHECK(singleton=1), window INTEGER NOT NULL, count INTEGER NOT NULL)`,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO room_meta VALUES (1, ?, ?, ?, ?)",
        meta.protocol,
        meta.access_hash,
        meta.created_at,
        meta.expires_at,
      );
    });
    await this.ctx.storage.setAlarm(Date.parse(meta.expires_at));
  }
  private meta(): Meta | undefined {
    const tables = this.ctx.storage.sql
      .exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='room_meta'",
      )
      .toArray();
    if (!tables.length) return undefined;
    return this.ctx.storage.sql
      .exec<Meta>(
        "SELECT protocol,access_hash,created_at,expires_at FROM room_meta WHERE singleton=1",
      )
      .toArray()[0];
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const meta = this.meta();
      if (!meta) fail(404, "NOT_FOUND", "Room not found or expired.");
      const access =
        request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
      let actual: string;
      try {
        actual = await hashAccess(access);
      } catch {
        return fail(403, "FORBIDDEN", "Invalid capability.");
      }
      // Compare fixed-size hashes without an early exit.
      let difference = 0;
      for (let i = 0; i < 43; i++)
        difference |= actual.charCodeAt(i) ^ meta!.access_hash.charCodeAt(i);
      if (difference) fail(403, "FORBIDDEN", "Invalid capability.");
      if (Date.now() >= Date.parse(meta!.expires_at))
        fail(410, "ROOM_EXPIRED", "This room has expired.");
      const url = new URL(request.url),
        eventsRoute = url.pathname.endsWith("/events");
      if (request.method === "GET" && !eventsRoute) {
        const last_seq = this.ctx.storage.sql
          .exec<{
            n: number;
          }>("SELECT COALESCE(MAX(seq),0) AS n FROM room_events")
          .one().n;
        return json({
          protocol: 1,
          last_seq,
          expires_at: meta!.expires_at,
          max_event_bytes: MAX_EVENT_BYTES,
        });
      }
      if (request.method === "GET" && eventsRoute) {
        const after = integer(
          url.searchParams.get("after") ?? "0",
          0,
          Number.MAX_SAFE_INTEGER,
        );
        const limit = integer(url.searchParams.get("limit") ?? "100", 1, 100);
        const rows = this.ctx.storage.sql
          .exec<EventRow>(
            "SELECT seq,event_id,nonce,ciphertext FROM room_events WHERE seq > ? ORDER BY seq LIMIT ?",
            after,
            limit + 1,
          )
          .toArray();
        const events = rows.slice(0, limit);
        return json({
          events,
          next_after: events.at(-1)?.seq ?? after,
          has_more: rows.length > limit,
        });
      }
      if (request.method === "POST" && eventsRoute) {
        const { raw, value } = await body(request);
        if (
          typeof value?.ciphertext === "string" &&
          value.ciphertext.length > Math.ceil((MAX_EVENT_BYTES * 4) / 3)
        )
          fail(413, "PAYLOAD_TOO_LARGE", "Event exceeds 64 KiB.");
        try {
          validateEnvelope(value);
        } catch (error) {
          if (
            error instanceof ProtocolError &&
            error.message.includes("64 KiB")
          )
            fail(413, "PAYLOAD_TOO_LARGE", "Event exceeds 64 KiB.");
          throw error;
        }
        const digest = base64url(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(raw),
            ),
          ),
        );
        const result = this.ctx.storage.transactionSync(() => {
          // Recheck after asynchronous body/hash work, including at the expiration boundary.
          if (Date.now() >= Date.parse(meta!.expires_at))
            fail(410, "ROOM_EXPIRED", "This room has expired.");
          const existing = this.ctx.storage.sql
            .exec<EventRow>(
              "SELECT seq,payload_digest FROM room_events WHERE event_id=?",
              value.event_id,
            )
            .toArray()[0];
          if (existing) {
            if (existing.payload_digest !== digest)
              fail(
                409,
                "EVENT_CONFLICT",
                "Event ID already exists with a different request.",
              );
            return { seq: existing.seq, duplicate: true };
          }
          const count = this.ctx.storage.sql
            .exec<{ n: number }>("SELECT COUNT(*) AS n FROM room_events")
            .one().n;
          if (count >= 2000)
            fail(
              429,
              "ROOM_FULL",
              "Room capacity reached. Create a new room.",
              Math.max(
                1,
                Math.ceil((Date.parse(meta!.expires_at) - Date.now()) / 1000),
              ),
            );
          const window = Math.floor(Date.now() / 60_000);
          const rate = this.ctx.storage.sql
            .exec<{
              window: number;
              count: number;
            }>("SELECT window,count FROM write_limits WHERE singleton=1")
            .toArray()[0];
          if (rate?.window === window && rate.count >= 30)
            fail(
              429,
              "RATE_LIMITED",
              "Room write limit reached. Try again in a minute.",
              60,
            );
          this.ctx.storage.sql.exec(
            "INSERT INTO write_limits VALUES(1,?,1) ON CONFLICT(singleton) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window",
            window,
          );
          const inserted = this.ctx.storage.sql
            .exec<{
              seq: number;
            }>("INSERT INTO room_events(event_id,nonce,ciphertext,payload_digest,stored_at) VALUES(?,?,?,?,?) RETURNING seq", value.event_id, value.nonce, value.ciphertext, digest, new Date().toISOString())
            .one();
          return { seq: inserted.seq, duplicate: false };
        });
        return json(
          { seq: result.seq, event_id: value.event_id },
          result.duplicate ? 200 : 201,
        );
      }
      return json(
        {
          error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
        },
        405,
        { Allow: eventsRoute ? "GET, POST" : "GET" },
      );
    } catch (error) {
      return errorResponse(error);
    }
  }
  async alarm() {
    const meta = this.meta();
    if (!meta || Date.now() >= Date.parse(meta.expires_at))
      await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(Date.parse(meta.expires_at));
  }
}
function integer(value: string, min: number, max: number): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    return fail(400, "INVALID_INPUT", "Invalid pagination parameter.");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    return fail(400, "INVALID_INPUT", "Pagination parameter out of range.");
  return n;
}
