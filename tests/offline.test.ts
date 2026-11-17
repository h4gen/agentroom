import { it, expect } from "vitest";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  decrypt,
  encrypt,
  inviteURL,
  message,
  randomSecret,
} from "../packages/protocol/src/index.ts";

it("the exact delivered offline module runs in isolated Node with no network/packages and interoperates with the protocol", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentroom-offline-"));
  try {
    const path = join(dir, "local.mjs");
    await writeFile(
      path,
      await readFile("apps/relay/src/mcp-local-client.txt"),
    );
    const invite = {
      origin: "https://relay.example",
      roomId: "AAAAAAAAAAAAAAAAAAAAAA",
      key: randomSecret(),
      access: randomSecret(),
    };
    const event = {
      ...(await encrypt(invite.roomId, invite.key, message("from browser"))),
      seq: 1,
    };
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      globalThis.fetch = () => { throw new Error("Network forbidden"); };
      const local = await import(${JSON.stringify(pathToFileURL(path).href)});
      let input = ""; for await (const chunk of process.stdin) input += chunk;
      const { link, event } = JSON.parse(input);
      console.log(JSON.stringify({
        args: local.readArgs(link),
        publish: await local.publishArgs(link, "from connector"),
        decoded: await local.decryptPage(link, { events: [event, { ...event, nonce: "AAAAAAAAAAAAAAAA" }], next_after: 2, has_more: false })
      }));
    `,
      ],
      {
        input: JSON.stringify({ link: inviteURL(invite), event }),
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.args).toEqual({
      room_id: invite.roomId,
      access: invite.access,
      after: 0,
      limit: 100,
    });
    expect(value.decoded.events[0].payload.body).toBe("from browser");
    expect(value.decoded.events[1].error).toContain("Cannot decrypt");
    expect(
      (await decrypt(invite.roomId, invite.key, value.publish.envelope)).body,
    ).toBe("from connector");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
