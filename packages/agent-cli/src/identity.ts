import {
  mkdir,
  readFile,
  writeFile,
  link,
  unlink,
  lstat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  generateIdentity,
  base64url,
  unbase64url,
  digest,
  ProtocolError,
  type Identity,
  type Invite,
} from "../../protocol/src/index.ts";

export async function loadIdentity(
  invite: Invite,
  name?: string,
): Promise<Identity> {
  const root =
    process.env.AGENTROOM_PROFILE_DIR ||
    join(
      process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
      "agentroom",
      "identities",
    );
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink())
    throw new ProtocolError("Identity directory must not be a symlink.");
  const room = await digest(
    new TextEncoder().encode(`${invite.origin}|${invite.roomId}`),
  );
  const path = join(root, `${room}.json`);
  try {
    return await restore(path);
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const identity = await generateIdentity(name);
  const data = {
    v: 2,
    publicKey: identity.publicKey,
    id: identity.id,
    name: identity.name,
    privateKey: base64url(
      new Uint8Array(
        await crypto.subtle.exportKey("pkcs8", identity.privateKey),
      ),
    ),
  };
  const temporary = join(root, `${room}.${crypto.randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: "wx" });
  try {
    // Hard-link installs a complete file atomically without replacing another process's profile.
    await link(temporary, path);
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary);
  }
  return restore(path);
}
async function restore(path: string): Promise<Identity> {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" && stat.mode & 0o077)
  )
    throw new ProtocolError(
      "Identity file is unsafe. Restrict access to its owner.",
    );
  let data: any;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new ProtocolError("Cannot read the existing identity profile.");
  }
  if (
    data.v !== 2 ||
    typeof data.name !== "string" ||
    !data.name ||
    data.name.length > 120 ||
    (await digest(unbase64url(data.publicKey, 32))) !== data.id
  )
    throw new ProtocolError("Invalid existing identity profile.");
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    unbase64url(data.privateKey),
    "Ed25519",
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "raw",
    unbase64url(data.publicKey, 32),
    "Ed25519",
    false,
    ["verify"],
  );
  const challenge = new TextEncoder().encode("agentroom/profile/v2");
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      await crypto.subtle.sign("Ed25519", privateKey, challenge),
      challenge,
    ))
  )
    throw new ProtocolError("Identity keys do not match.");
  return {
    privateKey,
    publicKey: data.publicKey,
    id: data.id,
    name: data.name,
  };
}
