import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createArgs,
  finishCreate,
  readArgs,
  publishArgs,
  decryptPage,
} from "../packages/protocol/src/offline.ts";
import { createRoom, RoomClient } from "../packages/protocol/src/client.ts";
import {
  encrypt,
  message,
  randomSecret,
  hashAccess,
  base64url,
} from "../packages/protocol/src/index.ts";
let mf: Miniflare,
  dir: string,
  counter = 0;
const origin = "https://relay.test";
const options = (persist: string) => ({
  ...convertV4MiniflareOptions({
    name: "relay",
    modules: true,
    scriptPath: "dist/relay/index.mjs",
    compatibilityDate: "2026-11-17",
    durableObjects: { ROOMS: { className: "Room", useSQLite: true } },
    durableObjectsPersist: persist,
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
  it("supports a real MCP client, ciphertext-only create/read/publish, local crypto, retries and capability errors", async () => {
    const sdk = new Client({ name: "acceptance", version: "1" });
    await sdk.connect(
      new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
        fetch: transport,
      }),
    );
    try {
      const list = await sdk.listTools();
      expect(list.tools.map((t) => t.name).sort()).toEqual([
        "agentroom_create",
        "agentroom_guide",
        "agentroom_publish",
        "agentroom_read",
      ]);
      expect(JSON.stringify(list)).not.toContain('"key":');
      const guide: any = await sdk.callTool({
        name: "agentroom_guide",
        arguments: {},
      });
      expect(guide.content[0].text).toContain("NEVER send K");
      expect(guide.content[1].text).toContain("function decryptPage");
      expect(guide.content[1].text).not.toMatch(/\bfetch\(/);
      const prepared = await createArgs();
      const created: any = await sdk.callTool({
        name: "agentroom_create",
        arguments: prepared.request,
      });
      expect(created.isError).toBeUndefined();
      const link = finishCreate(
        origin,
        created.structuredContent,
        prepared.local,
      );
      const args = await publishArgs(
        link,
        "MCP_PRIVATE_CANARY",
        "MCP_ACTOR_CANARY",
      );
      expect(JSON.stringify(args)).not.toContain(prepared.local.key);
      expect(JSON.stringify(args)).not.toContain("MCP_PRIVATE_CANARY");
      const first: any = await sdk.callTool({
        name: "agentroom_publish",
        arguments: args,
      });
      const retry: any = await sdk.callTool({
        name: "agentroom_publish",
        arguments: args,
      });
      expect(first.structuredContent.seq).toBe(1);
      expect(retry.structuredContent.seq).toBe(1);
      const read: any = await sdk.callTool({
        name: "agentroom_read",
        arguments: readArgs(link),
      });
      expect(JSON.stringify(read)).not.toContain("MCP_PRIVATE_CANARY");
      const decoded = await decryptPage(link, read.structuredContent);
      expect(decoded.events[0].payload?.body).toBe("MCP_PRIVATE_CANARY");
      // Existing HTTP clients read exactly the same stored room/event.
      const http = new RoomClient(
        {
          origin,
          roomId: created.structuredContent.room_id,
          ...prepared.local,
        },
        transport,
      );
      expect((await http.read()).events[0].payload?.body).toBe(
        "MCP_PRIVATE_CANARY",
      );
      const unauthorized: any = await sdk.callTool({
        name: "agentroom_read",
        arguments: { ...readArgs(link), access: randomSecret() },
      });
      expect(unauthorized.isError).toBe(true);
      expect(unauthorized.structuredContent.error.code).toBe("FORBIDDEN");
      const rejected: any = await sdk.callTool({
        name: "agentroom_read",
        arguments: { ...readArgs(link), key: "DO_NOT_ECHO_THIS_SECRET" },
      });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected)).not.toContain("DO_NOT_ECHO_THIS_SECRET");
      const sql = await storage(created.structuredContent.room_id);
      const rows = JSON.stringify([
        await sql.exec("SELECT * FROM room_meta"),
        await sql.exec("SELECT * FROM room_events"),
      ]);
      for (const secret of [
        prepared.local.key,
        prepared.local.access,
        "MCP_PRIVATE_CANARY",
        "MCP_ACTOR_CANARY",
      ])
        expect(rows).not.toContain(secret);
    } finally {
      await sdk.close();
    }
  });
  it("bounds MCP requests and rejects external browser origins and credential-bearing config URLs", async () => {
    expect((await call("/mcp")).status).toBe(405);
    expect((await call("/mcp?k=secret", { method: "POST" })).status).toBe(400);
    expect(
      (
        await call("/mcp", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    const oversized = await call("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: "x".repeat(100001),
    });
    expect(oversized.status).toBe(413);
  });
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
    const duplicate = await call(`/v1/rooms/${room.invite.roomId}/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });
    expect(duplicate.status).toBe(200);
    const changed = await call(`/v1/rooms/${room.invite.roomId}/events`, {
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
      path = `/v1/rooms/${room.invite.roomId}`;
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
        await call("/v1/rooms", {
          method: "POST",
          headers,
          body: JSON.stringify({ protocol: 2 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("/v1/rooms", {
          method: "POST",
          headers,
          body: JSON.stringify({
            protocol: 1,
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
      protocol: 1,
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
      protocol: 1,
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
      expect((await call("/v1/rooms", init)).status).toBe(201);
    const limited = await call("/v1/rooms", init);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });
  it("unknown-room GETs do not initialize tables; API misses stay JSON; headers are private", async () => {
    const name = "CCCCCCCCCCCCCCCCCCCCCC";
    expect(
      (
        await call(`/v1/rooms/${name}`, {
          headers: { Authorization: `Bearer ${randomSecret()}` },
        })
      ).status,
    ).toBe(404);
    expect(
      await (
        await storage(name)
      ).exec("SELECT name FROM sqlite_master WHERE name='room_meta'"),
    ).toEqual([]);
    const response = await call("/v1/missing");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await call("/protocol/v1")).status).toBe(200);
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
