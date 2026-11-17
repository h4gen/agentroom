import {
  generateIdentity,
  type Identity,
  type Invite,
} from "../../../packages/protocol/src/index.ts";
export type BrowserIdentity = { identity: Identity; temporary: boolean };
const pending = new Map<string, Promise<BrowserIdentity>>();
const roomKey = (invite: Invite) =>
  `agentroom:v2:${invite.origin}|${invite.roomId}`;
function openDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("agentroom-identities-v2", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("profiles");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(new Error("Identity storage unavailable."));
    open.onblocked = () => reject(new Error("Identity storage is blocked."));
  });
}
function put(db: IDBDatabase, room: string, identity: Identity) {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("profiles", "readwrite");
    transaction.objectStore("profiles").put(identity, `${room}|${identity.id}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export function browserIdentity(invite: Invite): Promise<BrowserIdentity> {
  const room = roomKey(invite);
  let promise = pending.get(room);
  if (!promise) {
    promise = load(room);
    pending.set(room, promise);
  }
  return promise;
}
export async function rememberName(
  invite: Invite,
  profile: BrowserIdentity,
  name: string,
) {
  profile.identity.name = name;
  if (profile.temporary) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    await put(db, roomKey(invite), profile.identity);
  } catch {
    profile.temporary = true;
  } finally {
    db?.close();
  }
}
async function load(room: string): Promise<BrowserIdentity> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const id = sessionStorage.getItem(room);
    if (id) {
      const stored = await new Promise<Identity | undefined>(
        (resolve, reject) => {
          const get = db!
            .transaction("profiles")
            .objectStore("profiles")
            .get(`${room}|${id}`);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        },
      );
      if (stored) return { identity: stored, temporary: false };
    }
    const created = await generateIdentity();
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      await crypto.subtle.exportKey("pkcs8", created.privateKey),
      "Ed25519",
      false,
      ["sign"],
    );
    const identity = { ...created, privateKey };
    await put(db, room, identity);
    sessionStorage.setItem(room, identity.id);
    return { identity, temporary: false };
  } catch {
    return { identity: await generateIdentity(), temporary: true };
  } finally {
    db?.close();
  }
}
