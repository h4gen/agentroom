import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoom, RoomClient } from "../packages/protocol/src/client.ts";
import {
  encrypt,
  message,
  randomSecret,
  hashAccess,
  base64url,
  encryptFile,
  generateIdentity,
  MAX_FILE_BYTES,
  MAX_ROOM_BYTES,
} from "../packages/protocol/src/index.ts";
let mf: Miniflare,
  dir: string,
  counter = 0;
const origin = "https://relay.test";
const options = (persist: string, scriptPath = "dist/relay/index.mjs") => ({
  ...convertV4MiniflareOptions({
    name: "relay",
    modules: true,
    scriptPath,
    compatibilityDate: "2026-11-17",
    durableObjects: { ROOMS: { className: "Room", useSQLite: true } },
    durableObjectsPersist: persist,
    r2Buckets: ["FILES"],
    r2Persist: persist,
    ratelimits: {
      CREATE_LIMIT: {
        namespace_id: "71001",
        simple: { limit: 6, period: 60 as const },
      },
      REQUEST_LIMIT: {
        namespace_id: "71002",
        simple: { limit: 120, period: 60 as const },
      },
    },
    serviceBindings: {
      ASSETS: async () => new Response("not found", { status: 404 }),
    },
  }),
  resourcePersistencePath: persist,
  unsafeInspectDurableObjects: true,
  logRequests: false,
});
const transport = (async (url: any, init: any = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("CF-Connecting-IP"))
    headers.set("CF-Connecting-IP", `test-${++counter}`);
  return mf.dispatchFetch(String(url), {
    ...init,
    headers,
  }) as unknown as Response;
}) as typeof fetch;
const call = (path: string, init: RequestInit = {}) =>
  transport(origin + path, init);
const create = () => createRoom(origin, 14, transport);
const client = (room: Awaited<ReturnType<typeof create>>) =>
  new RoomClient(room.invite, transport);
const storage = (name: string) =>
  mf.unsafeGetDurableObjectStorage("relay", "Room", { name });
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentroom-"));
  mf = new Miniflare(options(dir));
  await mf.ready;
});
afterAll(async () => {
  await mf?.dispose();
  if (dir) await rm(dir, { recursive: true, force: true });
});
describe("real Workers runtime and SQLite relay", () => {
  it("keeps two clients interoperable with ordered concurrent writes and pagination", async () => {
    const room = await create(),
      a = client(room),
      b = client(room);
    const written = await Promise.all([
      a.publish("A result", "A"),
      b.publish("B reply", "B"),
      a.publish("C result", "A"),
    ]);
    expect(written.map((e) => e.seq).sort()).toEqual([1, 2, 3]);
    const first = await a.page(0, 2);
    expect(first.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(first.has_more).toBe(true);
    const rest = await a.page(first.next_after, 2);
    expect(rest.events.map((e) => e.seq)).toEqual([3]);
    const all = await b.read();
    expect(all.events.every((e) => e.payload && !e.error)).toBe(true);
    expect((await a.status()).last_seq).toBe(3);
    expect((await a.page(99)).next_after).toBe(99);
  });
  it("deduplicates exact retries, including concurrent ones; rejects changed payloads", async () => {
    const room = await create(),
      a = client(room),
      event = await encrypt(
        room.invite.roomId,
        room.invite.key,
        message("idempotent"),
      );
    const result = await Promise.all([
      a.post(event),
      a.post(event),
      a.post(event),
    ]);
    expect(result.map((e) => e.seq)).toEqual([1, 1, 1]);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${room.invite.access}`,
    };
    const duplicate = await call(`/v2/rooms/${room.invite.roomId}/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });
    expect(duplicate.status).toBe(200);
    const changed = await call(`/v2/rooms/${room.invite.roomId}/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event, null, 2),
    });
    expect(changed.status).toBe(409);
    expect((await a.status()).last_seq).toBe(1);
  });
  it("stores ciphertext only, with capability hash rather than K/A or plaintext", async () => {
    const room = await create(),
      a = client(room);
    await a.publish("PRIVATE_BODY_CANARY", "PRIVATE_ACTOR_CANARY");
    const sql = await storage(room.invite.roomId);
    const rows = JSON.stringify([
      await sql.exec("SELECT * FROM room_meta"),
      await sql.exec("SELECT * FROM room_events"),
    ]);
    for (const secret of [
      room.invite.key,
      room.invite.access,
      "PRIVATE_BODY_CANARY",
      "PRIVATE_ACTOR_CANARY",
    ])
      expect(rows).not.toContain(secret);
    expect(rows).toContain(await hashAccess(room.invite.access));
  });
  it("rejects unauthorized access, invalid envelopes, oversized events and invalid cursors", async () => {
    const room = await create(),
      path = `/v2/rooms/${room.invite.roomId}`;
    expect((await call(path)).status).toBe(401);
    expect(
      (
        await call(path, {
          headers: { Authorization: `Bearer ${randomSecret()}` },
        })
      ).status,
    ).toBe(403);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${room.invite.access}`,
    };
    for (const suffix of [
      "/events?after=-1",
      "/events?limit=101",
      "/events?after=9007199254740992",
      "/events?after=1.5",
    ])
      expect((await call(path + suffix, { headers })).status).toBe(400);
    const event = await encrypt(
      room.invite.roomId,
      room.invite.key,
      message("valid"),
    );
    for (const value of [
      { ...event, nonce: randomSecret() },
      { ...event, actor: "plain" },
      { ...event, ciphertext: "AA==" },
      {},
    ])
      expect(
        (
          await call(path + "/events", {
            method: "POST",
            headers,
            body: JSON.stringify(value),
          })
        ).status,
      ).toBe(400);
    const big = { ...event, ciphertext: base64url(new Uint8Array(65537)) };
    expect(
      (
        await call(path + "/events", {
          method: "POST",
          headers,
          body: JSON.stringify(big),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await call(path + "/events", {
          method: "POST",
          headers,
          body: "x".repeat(90001),
        })
      ).status,
    ).toBe(413);
    expect((await call(path + "?k=secret", { headers })).status).toBe(400);
    expect(
      (
        await call("/v2/rooms", {
          method: "POST",
          headers,
          body: JSON.stringify({ protocol: 1 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("/v2/rooms", {
          method: "POST",
          headers,
          body: JSON.stringify({
            protocol: 2,
            access_hash: await hashAccess(randomSecret()),
            ttl_days: 31,
          }),
        })
      ).status,
    ).toBe(400);
  });
  it("rejects expired reads/writes and removes expired data idempotently", async () => {
    const room = await create(),
      a = client(room),
      sql = await storage(room.invite.roomId);
    await a.publish("will expire");
    await sql.exec(
      "UPDATE room_meta SET expires_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await expect(a.status()).rejects.toMatchObject({ status: 410 });
    await expect(a.publish("too late")).rejects.toMatchObject({ status: 410 });
    // A separate real alarm verifies cleanup without exposing a test endpoint in production.
    const ns = await mf.getDurableObjectNamespace("ROOMS");
    const name = "BBBBBBBBBBBBBBBBBBBBBB",
      stub = ns.get(ns.idFromName(name)) as any;
    await stub.initialize({
      protocol: 2,
      access_hash: await hashAccess(randomSecret()),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 150).toISOString(),
    });
    const target = await storage(name);
    await expect
      .poll(
        async () =>
          await target.exec(
            "SELECT name FROM sqlite_master WHERE name='room_meta'",
          ),
        { timeout: 5000 },
      )
      .toEqual([]);
  });
  it("enforces room capacity and persisted write limits while allowing retries", async () => {
    const room = await create(),
      a = client(room),
      event = await encrypt(
        room.invite.roomId,
        room.invite.key,
        message("one"),
      );
    await a.post(event);
    const sql = await storage(room.invite.roomId);
    await sql.exec(
      "UPDATE write_limits SET count=30,window=?",
      Math.floor(Date.now() / 60000),
    );
    expect((await a.post(event)).seq).toBe(1);
    await expect(a.publish("blocked")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
    await sql.exec(
      "WITH RECURSIVE n(x) AS (SELECT 2 UNION ALL SELECT x+1 FROM n WHERE x<2000) INSERT INTO room_events(seq,event_id,nonce,ciphertext,payload_digest,stored_at) SELECT x, 'seed-'||x, 'nonce', 'cipher', 'digest', 'time' FROM n",
    );
    await expect(a.publish("full")).rejects.toMatchObject({
      status: 429,
      code: "ROOM_FULL",
    });
    expect((await a.post(event)).seq).toBe(1);
  });
  it("applies creation IP limits and returns Retry-After", async () => {
    const body = JSON.stringify({
      protocol: 2,
      access_hash: await hashAccess(randomSecret()),
      ttl_days: 1,
    });
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "same-limit-test",
      },
      body,
    };
    for (let i = 0; i < 6; i++)
      expect((await call("/v2/rooms", init)).status).toBe(201);
    const limited = await call("/v2/rooms", init);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });
  it("unknown-room GETs do not initialize tables; API misses stay JSON; headers are private", async () => {
    const name = "CCCCCCCCCCCCCCCCCCCCCC";
    expect(
      (
        await call(`/v2/rooms/${name}`, {
          headers: { Authorization: `Bearer ${randomSecret()}` },
        })
      ).status,
    ).toBe(404);
    expect(
      await (
        await storage(name)
      ).exec("SELECT name FROM sqlite_master WHERE name='room_meta'"),
    ).toEqual([]);
    const response = await call("/v2/missing");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await call("/protocol/v2")).status).toBe(200);
  });
  it("stores immutable opaque files, protects access and verifies binary roundtrips", async () => {
    const room = await create(),
      a = client(room),
      bytes = new TextEncoder().encode("id,value\n1,42\n");
    const file = await encryptFile(
      room.invite.roomId,
      room.invite.key,
      bytes,
      "SECRET_FILENAME.csv",
      "text/csv",
    );
    const [one, two] = await Promise.all([
      a.upload(file.attachment.blob_id, file.ciphertext),
      a.upload(file.attachment.blob_id, file.ciphertext),
    ]);
    expect(one).toMatchObject({ blob_id: file.attachment.blob_id });
    expect(two).toEqual(one);
    const different = file.ciphertext.slice();
    different[12] ^= 1;
    await expect(
      a.upload(file.attachment.blob_id, different),
    ).rejects.toMatchObject({ status: 409 });
    expect(await a.download(file.attachment)).toEqual(bytes);
    const stored = await a.publish(
      "attached",
      "Files A",
      await generateIdentity("Files A"),
      [file.attachment],
    );
    expect((await a.read()).events[0].payload?.attachments[0]).toEqual(
      file.attachment,
    );
    const path = `/v2/rooms/${room.invite.roomId}/blobs/${file.attachment.blob_id}`;
    expect((await call(path)).status).toBe(401);
    expect(
      (
        await call(path, {
          headers: { Authorization: `Bearer ${randomSecret()}` },
        })
      ).status,
    ).toBe(403);
    const sql = await storage(room.invite.roomId);
    const serialized = JSON.stringify(
      await sql.exec("SELECT * FROM room_blobs"),
    );
    expect(serialized).not.toContain("SECRET_FILENAME");
    expect(serialized).not.toContain(room.invite.key);
    const bucket = await mf.getR2Bucket("FILES"),
      objects = await bucket.list();
    expect(
      objects.objects.every((o) => !o.key.includes("SECRET_FILENAME")),
    ).toBe(true);
    await sql.exec(
      "UPDATE room_meta SET expires_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await expect(a.download(file.attachment)).rejects.toMatchObject({
      status: 410,
    });
    await expect(
      a.upload(crypto.randomUUID(), file.ciphertext),
    ).rejects.toMatchObject({ status: 410 });
    expect(stored.seq).toBe(1);
  });
  it("roundtrips the full supported 10 MiB file size", async () => {
    const room = await create(),
      a = client(room),
      bytes = new Uint8Array(MAX_FILE_BYTES);
    bytes[0] = 42;
    bytes[bytes.length - 1] = 99;
    const file = await encryptFile(
      room.invite.roomId,
      room.invite.key,
      bytes,
      "maximum.bin",
    );
    await a.upload(file.attachment.blob_id, file.ciphertext);
    expect(
      Buffer.from(await a.download(file.attachment)).equals(Buffer.from(bytes)),
    ).toBe(true);
  });
  it("rejects oversized uploads and atomically reserves count and byte quotas", async () => {
    const room = await create(),
      a = client(room),
      sql = await storage(room.invite.roomId);
    await expect(
      a.upload(crypto.randomUUID(), new Uint8Array(MAX_FILE_BYTES + 29)),
    ).rejects.toMatchObject({ status: 413 });
    const file = await encryptFile(
      room.invite.roomId,
      room.invite.key,
      new Uint8Array(1),
      "a",
    );
    await sql.exec(
      "INSERT INTO room_blobs VALUES('reservation', ?, 'digest', 0)",
      MAX_ROOM_BYTES - file.ciphertext.length,
    );
    const results = await Promise.allSettled([
      a.upload(crypto.randomUUID(), file.ciphertext),
      a.upload(crypto.randomUUID(), file.ciphertext),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason,
    ).toMatchObject({ code: "FILE_QUOTA" });
    await sql.exec("DELETE FROM room_blobs");
    await sql.exec(
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100) INSERT INTO room_blobs SELECT 'seed-'||x,28,'digest',0 FROM n",
    );
    await expect(
      a.upload(crypto.randomUUID(), file.ciphertext),
    ).rejects.toMatchObject({ code: "FILE_QUOTA" });
  });
  it("retires v1 and rejects old rooms without migrating or deleting their data", async () => {
    expect((await call("/v1/rooms")).status).toBe(410);
    expect((await call("/protocol/v1")).status).toBe(410);
    const room = await create(),
      sql = await storage(room.invite.roomId);
    await client(room).publish("retained until expiry");
    await sql.exec("UPDATE room_meta SET protocol=1");
    await expect(client(room).status()).rejects.toMatchObject({
      code: "UNSUPPORTED_ROOM_PROTOCOL",
      status: 409,
    });
    expect((await sql.exec("SELECT COUNT(*) AS n FROM room_events"))[0].n).toBe(
      1,
    );
  });
  it("retains ciphertext and sequence numbers across a complete runtime restart", async () => {
    const room = await create();
    await client(room).publish("before restart");
    await mf.dispose();
    mf = new Miniflare(options(dir));
    await mf.ready;
    const a = client(room);
    expect((await a.read()).events[0].payload?.body).toBe("before restart");
    expect((await a.publish("after restart")).seq).toBe(2);
  });
});

describe("R2 failure recovery at the real Workers boundary", () => {
  let faultMF: Miniflare, faultDir: string;
  beforeAll(async () => {
    const { build } = await import("esbuild");
    await build({
      entryPoints: ["tests/fixtures/fault-relay.mjs"],
      outfile: ".wrangler/fault-relay.mjs",
      bundle: true,
      platform: "browser",
      format: "esm",
      external: ["cloudflare:workers"],
      loader: { ".md": "text" },
    });
    faultDir = await mkdtemp(join(tmpdir(), "agentroom-fault-"));
    faultMF = new Miniflare(options(faultDir, ".wrangler/fault-relay.mjs"));
    await faultMF.ready;
  });
  afterAll(async () => {
    await faultMF?.dispose();
    if (faultDir) await rm(faultDir, { recursive: true, force: true });
  });
  async function fixture(ttl = 60_000) {
    const name = base64url(crypto.getRandomValues(new Uint8Array(16))),
      access = randomSecret();
    const ns = await faultMF.getDurableObjectNamespace("ROOMS"),
      objectId = ns.idFromName(name),
      stub = ns.get(objectId) as any;
    await stub.initialize({
      protocol: 2,
      access_hash: await hashAccess(access),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttl).toISOString(),
    });
    const fetcher = ((url: any, init?: any) =>
      faultMF.dispatchFetch(String(url), {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          "CF-Connecting-IP": `fault-${++counter}`,
        },
      })) as typeof fetch;
    const invite = { origin, roomId: name, key: randomSecret(), access };
    const a = new RoomClient(invite, fetcher);
    const file = await encryptFile(
      name,
      invite.key,
      new Uint8Array([1, 2, 3]),
      "result.csv",
    );
    const bucket = await faultMF.getR2Bucket("FILES"),
      key = `${objectId.toString()}/${file.attachment.blob_id}`;
    return {
      a,
      file,
      stub,
      bucket,
      key,
      name,
      sql: await faultMF.unsafeGetDurableObjectStorage("relay", "Room", {
        name,
      }),
    };
  }
  it("retains a failed upload reservation and recovers the same immutable operation", async () => {
    const { a, file, stub, sql, bucket, key } = await fixture();
    await stub.setFault("put");
    await expect(
      a.upload(file.attachment.blob_id, file.ciphertext),
    ).rejects.toMatchObject({ status: 500 });
    expect((await sql.exec("SELECT ready FROM room_blobs"))[0].ready).toBe(0);
    expect(await bucket.head(key)).toBeNull();
    await stub.setFault("");
    await a.upload(file.attachment.blob_id, file.ciphertext);
    expect(await a.download(file.attachment)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await stub.setFault("get");
    await expect(a.download(file.attachment)).rejects.toMatchObject({
      status: 500,
    });
    await stub.setFault("");
    expect(await a.download(file.attachment)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
  it("keeps cleanup state when R2 deletion fails and removes orphan files on retry", async () => {
    const { a, file, stub, sql, bucket, key } = await fixture();
    await a.upload(file.attachment.blob_id, file.ciphertext); // Deliberately no referencing event.
    await sql.exec(
      "UPDATE room_meta SET expires_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await stub.setFault("delete");
    await stub.runCleanup();
    expect(await sql.exec("SELECT * FROM room_meta")).toHaveLength(1);
    expect(await bucket.head(key)).not.toBeNull();
    await expect(a.status()).rejects.toMatchObject({ status: 410 });
    await stub.setFault("");
    await stub.runCleanup();
    expect(await bucket.head(key)).toBeNull();
    expect(
      await sql.exec("SELECT name FROM sqlite_master WHERE name='room_meta'"),
    ).toEqual([]);
    await stub.runCleanup(); // Idempotent even after metadata is gone.
  });
  it("does not leave a file accessible when expiry happens during an upload", async () => {
    const { a, file, stub, bucket, key } = await fixture(300);
    await stub.setFault("slow-put");
    await expect(
      a.upload(file.attachment.blob_id, file.ciphertext),
    ).rejects.toMatchObject({ status: 410 });
    await expect.poll(() => bucket.head(key)).toBeNull();
  });
});
