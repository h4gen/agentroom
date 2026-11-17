import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateIdentity,
  encrypt,
  decrypt,
  message,
  verifyMessage,
  encryptFile,
  decryptFile,
  randomSecret,
  unbase64url,
  MAX_FILE_BYTES,
  safeFilename,
} from "../packages/protocol/src/index.ts";
import { loadIdentity } from "../packages/agent-cli/src/identity.ts";
import { RoomClient } from "../packages/protocol/src/client.ts";
import vector from "./vectors/aes-gcm.json";
const room = "AAAAAAAAAAAAAAAAAAAAAA";
describe("v2 signed participants and encrypted attachments", () => {
  it("independently generated Python attachment decrypts byte-for-byte", async () => {
    const payload = await decrypt(vector.room_id, vector.key, vector.envelope);
    const bytes = await decryptFile(
      vector.room_id,
      vector.key,
      payload.attachments[0],
      unbase64url(vector.blob.ciphertext),
    );
    expect(bytes).toEqual(unbase64url(vector.blob.plaintext));
  });
  it("binds names, body, keys, attachments, room and event to the signature", async () => {
    const identity = await generateIdentity("Same name"),
      other = await generateIdentity("Same name"),
      key = randomSecret();
    expect(identity.id).not.toBe(other.id);
    const file = await encryptFile(
      room,
      key,
      new TextEncoder().encode("a,b\n1,2"),
      "table.csv",
      "text/csv",
    );
    const event = await encrypt(
      room,
      key,
      message("result", identity.name, [file.attachment]),
      identity,
    );
    const payload = await decrypt(room, key, event);
    for (const mutation of [
      { ...payload, body: "changed" },
      { ...payload, actor: { ...payload.actor, name: "Other" } },
      { ...payload, actor: { ...payload.actor, public_key: other.publicKey } },
      {
        ...payload,
        attachments: [{ ...payload.attachments[0], name: "fake.csv" }],
      },
      { ...payload, attachments: [] },
    ])
      await expect(
        verifyMessage(room, event.event_id, mutation),
      ).rejects.toThrow();
    await expect(
      verifyMessage("BAAAAAAAAAAAAAAAAAAAAA", event.event_id, payload),
    ).rejects.toThrow();
    await expect(
      verifyMessage(room, crypto.randomUUID(), payload),
    ).rejects.toThrow();
    await expect(
      verifyMessage(room, event.event_id, { ...payload, v: 1 } as any),
    ).rejects.toThrow();
    const unsigned = { ...payload };
    delete (unsigned as any).signature;
    await expect(
      verifyMessage(room, event.event_id, unsigned),
    ).rejects.toThrow();
  });
  it("detects swapped files, corruption, wrong keys, size and checksum", async () => {
    const key = randomSecret(),
      bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic\n");
    const a = await encryptFile(room, key, bytes, "result.pdf"),
      b = await encryptFile(room, key, bytes, "result.pdf");
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(await decryptFile(room, key, a.attachment, a.ciphertext)).toEqual(
      bytes,
    );
    const corrupt = a.ciphertext.slice();
    corrupt[15] ^= 1;
    for (const [secret, attachment, ciphertext] of [
      [randomSecret(), a.attachment, a.ciphertext],
      [key, a.attachment, b.ciphertext],
      [key, a.attachment, corrupt],
      [key, { ...a.attachment, size: 0 }, a.ciphertext],
      [key, { ...a.attachment, sha256: randomSecret() }, a.ciphertext],
    ] as const)
      await expect(
        decryptFile(room, secret, attachment, ciphertext),
      ).rejects.toThrow();
    await expect(
      encryptFile(room, key, new Uint8Array(MAX_FILE_BYTES + 1), "too-big"),
    ).rejects.toThrow();
    expect(safeFilename("../../unsafe\u0000.html")).toBe("unsafe.html");
  });
  it("gives binary file transfers enough time while keeping ordinary API deadlines short", async () => {
    const timeouts: number[] = [];
    const clock = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      timeouts.push(ms);
      return new AbortController().signal;
    });
    try {
      const invite = {
        origin: "https://example.test",
        roomId: room,
        key: randomSecret(),
        access: randomSecret(),
      };
      const file = await encryptFile(
        room,
        invite.key,
        new Uint8Array([1, 2, 3]),
        "test.bin",
      );
      const transport = vi.fn(async (_url: any, init: any) =>
        init?.method === "PUT"
          ? Response.json({ blob_id: file.attachment.blob_id })
          : String(_url).includes("/blobs/")
            ? new Response(file.ciphertext)
            : Response.json({ protocol: 2 }),
      ) as typeof fetch;
      const client = new RoomClient(invite, transport);
      await client.status();
      await client.upload(file.attachment.blob_id, file.ciphertext);
      expect(await client.download(file.attachment)).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(timeouts).toEqual([20_000, 120_000, 120_000]);
    } finally {
      clock.mockRestore();
    }
  });
  it("atomically reuses a private local profile, even under concurrent first use", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentroom-identity-")),
      before = process.env.AGENTROOM_PROFILE_DIR;
    process.env.AGENTROOM_PROFILE_DIR = root;
    try {
      const invite = {
        origin: "https://example.test",
        roomId: room,
        key: randomSecret(),
        access: randomSecret(),
      };
      const profiles = await Promise.all(
        Array.from({ length: 5 }, () => loadIdentity(invite, "Agent A")),
      );
      expect(new Set(profiles.map((p) => p.id)).size).toBe(1);
      expect((await loadIdentity(invite)).id).toBe(profiles[0].id);
      const files = await readdir(root);
      expect(files).toHaveLength(1);
      const saved = await readFile(join(root, files[0]), "utf8");
      expect(saved).not.toContain(invite.key);
      expect(saved).not.toContain(invite.access);
      expect((await stat(join(root, files[0]))).mode & 0o077).toBe(0);
      expect(
        (await loadIdentity({ ...invite, roomId: "BAAAAAAAAAAAAAAAAAAAAA" }))
          .id,
      ).not.toBe(profiles[0].id);
    } finally {
      if (before === undefined) delete process.env.AGENTROOM_PROFILE_DIR;
      else process.env.AGENTROOM_PROFILE_DIR = before;
      await rm(root, { recursive: true, force: true });
    }
  });
});
