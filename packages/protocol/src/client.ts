import {
  PROTOCOL,
  decrypt,
  encrypt,
  hashAccess,
  inviteURL,
  message,
  randomSecret,
  validOrigin,
  decryptFile,
  type Attachment,
  type Identity,
  type Envelope,
  type Invite,
  type Message,
  type StoredEvent,
} from "./index.ts";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    text: string,
  ) {
    super(text);
  }
}
export interface RoomInfo {
  protocol: number;
  last_seq: number;
  expires_at: string;
  max_event_bytes: number;
}
export interface Page {
  events: StoredEvent[];
  next_after: number;
  has_more: boolean;
}
type Fetch = typeof fetch;
export class RoomClient {
  constructor(
    readonly invite: Invite,
    private transport: Fetch = fetch,
  ) {}
  private async response(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    // Only the origin, room ID and capability enter HTTP. Never pass the invitation URL to fetch.
    const url = `${this.invite.origin}/v2/rooms/${this.invite.roomId}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.invite.access}`);
    if (init.body && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const transport = this.transport;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await transport(url, {
          ...init,
          headers,
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        if (attempt < 2) {
          await delay(attempt);
          continue;
        }
        throw new ApiError(
          0,
          "NETWORK_ERROR",
          "Network request failed. A write may have been stored; read the room before publishing again.",
        );
      }
      if ((response.status >= 500 || response.status === 429) && attempt < 2) {
        const seconds = Number(response.headers.get("Retry-After") ?? 0);
        if (seconds <= 5) {
          await delay(attempt, seconds);
          continue;
        }
      }
      if (!response.ok) {
        const data = (await response.json()) as any;
        throw new ApiError(
          response.status,
          data.error?.code ?? "HTTP_ERROR",
          data.error?.message ?? "Request failed.",
        );
      }
      return response;
    }
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await this.response(path, init)).json();
  }
  status(): Promise<RoomInfo> {
    return this.request("");
  }
  page(after = 0, limit = 100): Promise<Page> {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Invalid event cursor or page limit.");
    return this.request(`/events?after=${after}&limit=${limit}`);
  }
  post(event: Envelope): Promise<{ seq: number; event_id: string }> {
    return this.request("/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
  }
  async publish(
    body: string,
    actor?: string,
    identity?: Identity,
    attachments: Attachment[] = [],
  ) {
    return this.post(
      await encrypt(
        this.invite.roomId,
        this.invite.key,
        message(body, actor, attachments),
        identity,
      ),
    );
  }
  async upload(blobId: string, bytes: Uint8Array<ArrayBuffer>) {
    return this.request(`/blobs/${blobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
  }
  async download(attachment: Attachment) {
    const response = await this.response(`/blobs/${attachment.blob_id}`);
    const length = Number(response.headers.get("Content-Length"));
    if (length && length !== attachment.size + 28)
      throw new Error("Attachment size mismatch.");
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > attachment.size + 28) {
        await reader.cancel();
        throw new Error("Attachment exceeds declared size.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return decryptFile(this.invite.roomId, this.invite.key, attachment, bytes);
  }
  async read(after = 0): Promise<{
    events: {
      seq: number;
      event_id: string;
      payload?: Message;
      error?: string;
    }[];
    next_after: number;
  }> {
    const events: {
        seq: number;
        event_id: string;
        payload?: Message;
        error?: string;
      }[] = [],
      seen = new Set<string>();
    let cursor = after,
      pages = 0;
    while (true) {
      const page = await this.page(cursor);
      if (
        !Array.isArray(page.events) ||
        page.events.length > 100 ||
        typeof page.has_more !== "boolean" ||
        !Number.isSafeInteger(page.next_after) ||
        page.next_after < cursor ||
        (page.has_more && page.next_after <= cursor) ||
        ++pages > 2000
      )
        throw new Error("Relay returned an invalid event page.");
      let previousSeq = cursor;
      for (const event of page.events) {
        if (
          !Number.isSafeInteger(event.seq) ||
          event.seq <= previousSeq ||
          seen.has(event.event_id)
        )
          throw new Error("Relay returned inconsistent event ordering.");
        seen.add(event.event_id);
        previousSeq = event.seq;
        try {
          events.push({
            seq: event.seq,
            event_id: event.event_id,
            payload: await decrypt(this.invite.roomId, this.invite.key, event),
          });
        } catch {
          events.push({
            seq: event.seq,
            event_id: event.event_id,
            error:
              "Cannot verify this event: wrong key, altered data, invalid signature or unsupported payload.",
          });
        }
      }
      if (page.next_after !== previousSeq)
        throw new Error("Relay returned an inconsistent event cursor.");
      cursor = page.next_after;
      if (!page.has_more) return { events, next_after: cursor };
    }
  }
}
async function delay(attempt: number, retry = 0) {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(retry * 1000, 200 * 2 ** attempt)),
  );
}
export async function createRoom(
  origin: string,
  ttl_days = 14,
  transport: Fetch = fetch,
) {
  origin = validOrigin(origin);
  const key = randomSecret(),
    access = randomSecret();
  const response = await transport(`${origin}/v2/rooms`, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocol: PROTOCOL,
      access_hash: await hashAccess(access),
      ttl_days,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error?.code ?? "CREATE_FAILED",
      data.error?.message ?? "Could not create room.",
    );
  const invite: Invite = { origin, roomId: data.room_id, key, access };
  return { invite, url: inviteURL(invite), expires_at: data.expires_at };
}
