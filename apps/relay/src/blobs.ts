import {
  MAX_FILE_BYTES,
  MAX_ROOM_BYTES,
  MAX_BLOBS,
  base64url,
} from "../../../packages/protocol/src/index.ts";
import { fail } from "./http.ts";
type BlobRow = { blob_id: string; size: number; digest: string; ready: number };
export class BlobStore {
  constructor(
    private storage: DurableObjectStorage,
    private bucket: R2Bucket,
    private prefix: string,
    private expires: string,
  ) {}
  private live() {
    if (Date.now() >= Date.parse(this.expires))
      fail(410, "ROOM_EXPIRED", "This room has expired.");
  }
  initialize() {
    this.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_blobs (blob_id TEXT PRIMARY KEY, size INTEGER NOT NULL, digest TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0)",
    );
  }
  async get(id: string) {
    const row = this.storage.sql
      .exec<BlobRow>("SELECT * FROM room_blobs WHERE blob_id=? AND ready=1", id)
      .toArray()[0];
    if (!row) fail(404, "BLOB_NOT_FOUND", "Attachment not found.");
    const object = await this.bucket.get(this.prefix + id);
    this.live();
    if (!object) fail(404, "BLOB_NOT_FOUND", "Attachment not found.");
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        "Cache-Control": "no-store",
      },
    });
  }
  async put(id: string, request: Request) {
    if (
      request.headers.get("Content-Type")?.split(";")[0].trim() !==
      "application/octet-stream"
    )
      fail(400, "INVALID_INPUT", "Use application/octet-stream.");
    if (
      Number(request.headers.get("Content-Length") || 0) >
      MAX_FILE_BYTES + 28
    )
      fail(413, "PAYLOAD_TOO_LARGE", "File exceeds 10 MiB.");
    const reader = request.body?.getReader();
    if (!reader) fail(400, "INVALID_INPUT", "Encrypted bytes required.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES + 28) {
        await reader.cancel();
        fail(413, "PAYLOAD_TOO_LARGE", "File exceeds 10 MiB.");
      }
      chunks.push(value);
    }
    if (size < 28) fail(400, "INVALID_INPUT", "Encrypted file is too short.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const digest = base64url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    );
    this.live();
    const duplicate = this.storage.transactionSync(() => {
      const row = this.storage.sql
        .exec<BlobRow>("SELECT * FROM room_blobs WHERE blob_id=?", id)
        .toArray()[0];
      if (row) {
        if (row.digest !== digest || row.size !== size)
          fail(409, "BLOB_CONFLICT", "Blob ID already has different bytes.");
        return row.ready === 1;
      }
      const totals = this.storage.sql
        .exec<{
          count: number;
          bytes: number;
        }>("SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM room_blobs")
        .one();
      if (totals.count >= MAX_BLOBS || totals.bytes + size > MAX_ROOM_BYTES)
        fail(429, "FILE_QUOTA", "Room file capacity reached.");
      this.storage.sql.exec(
        "INSERT INTO room_blobs(blob_id,size,digest,ready) VALUES(?,?,?,0)",
        id,
        size,
        digest,
      );
      return false;
    });
    if (duplicate) return Response.json({ blob_id: id, size }, { status: 200 });
    const key = this.prefix + id;
    const object = await this.bucket.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { digest, expires_at: this.expires },
    });
    if (!object) {
      const existing = await this.bucket.head(key);
      if (
        !existing ||
        existing.customMetadata?.digest !== digest ||
        existing.size !== size
      )
        fail(409, "BLOB_CONFLICT", "Blob ID already has different bytes.");
    }
    if (Date.now() >= Date.parse(this.expires)) {
      try {
        await this.bucket.delete(key);
      } catch {
        await this.storage.setAlarm(Date.now() + 60_000);
      }
      fail(410, "ROOM_EXPIRED", "This room expired during upload.");
    }
    this.storage.sql.exec("UPDATE room_blobs SET ready=1 WHERE blob_id=?", id);
    return Response.json({ blob_id: id, size }, { status: 201 });
  }
  async cleanup() {
    let cursor: string | undefined;
    do {
      const objects = await this.bucket.list({ prefix: this.prefix, cursor });
      if (objects.objects.length)
        await this.bucket.delete(objects.objects.map((o) => o.key));
      cursor = objects.truncated ? objects.cursor : undefined;
    } while (cursor);
  }
}
