// Network-free bridge using the same protocol as the browser and CLI.
import {
  decrypt,
  encrypt,
  hashAccess,
  inviteURL,
  message,
  parseInvite,
  randomSecret,
  validOrigin,
  type StoredEvent,
} from "./index.ts";
export function readArgs(link: string, after = 0, limit = 100) {
  const { roomId, access } = parseInvite(link);
  return { room_id: roomId, access, after, limit };
}
export async function publishArgs(
  link: string,
  body: string,
  actor = "Anonymous",
) {
  const { roomId, access, key } = parseInvite(link);
  return {
    room_id: roomId,
    access,
    envelope: await encrypt(roomId, key, message(body, actor)),
  };
}
export async function decryptPage(
  link: string,
  page: { events: StoredEvent[]; next_after: number; has_more: boolean },
) {
  const { roomId, key } = parseInvite(link);
  const events = await Promise.all(
    page.events.map(async (event) => {
      try {
        return {
          seq: event.seq,
          event_id: event.event_id,
          payload: await decrypt(roomId, key, event),
        };
      } catch {
        return {
          seq: event.seq,
          event_id: event.event_id,
          error: "Cannot decrypt event: wrong key or altered data.",
        };
      }
    }),
  );
  return { events, next_after: page.next_after, has_more: page.has_more };
}
export async function createArgs(ttl_days = 14) {
  const key = randomSecret(),
    access = randomSecret();
  return {
    local: { key, access },
    request: {
      protocol: 1 as const,
      access_hash: await hashAccess(access),
      ttl_days,
    },
  };
}
export function finishCreate(
  origin: string,
  result: { room_id: string },
  local: { key: string; access: string },
) {
  return inviteURL({
    origin: validOrigin(origin),
    roomId: result.room_id,
    ...local,
  });
}
