import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin = new URL(
  process.argv[2] || "https://agentroom-v0.hagen-hoferichter.workers.dev",
).origin;
const check = (value, message) => {
  if (!value) throw new Error(message);
};
const cli = (args, input, profile = "a") => {
  const result = spawnSync(process.execPath, ["dist/agentroom.mjs", ...args], {
    input,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      AGENTROOM_PROFILE_DIR: join(
        process.cwd(),
        ".wrangler",
        "smoke-identities",
        profile,
      ),
    },
  });
  if (result.status !== 0)
    throw new Error(
      `CLI smoke failed (${result.status}); invitation and private output suppressed.`,
    );
  return JSON.parse(result.stdout);
};
await mkdir(".wrangler", { recursive: true });
const statePath = ".wrangler/accepted-smoke-v2.local";
let previous, legacy;
try {
  previous = JSON.parse(await readFile(statePath, "utf8"));
} catch {}
try {
  legacy = JSON.parse(await readFile(".wrangler/accepted-smoke.local", "utf8"));
} catch {}
if (previous?.origin === origin) {
  const old = cli(["read", "--invite-stdin", "--json"], previous.url);
  check(
    old.events.some((e) => e.payload?.body === previous.marker),
    "Previously accepted v2 room content is missing.",
  );
  console.log("Retained accepted v2 room: passed.");
}
if (legacy?.origin === origin) {
  const url = new URL(legacy.url),
    id = url.pathname.split("/").at(-1),
    access = new URLSearchParams(url.hash.slice(1)).get("a");
  const response = await fetch(`${origin}/v2/rooms/${id}`, {
    headers: { Authorization: `Bearer ${access}` },
    redirect: "error",
  });
  check(
    response.status === 409 ||
      response.status === 410 ||
      response.status === 404,
    "Old room retirement did not fail explicitly.",
  );
  if (response.status === 409)
    check(
      (await response.json()).error?.code === "UNSUPPORTED_ROOM_PROTOCOL",
      "Unexpected old-room response.",
    );
  console.log(
    `Old room retirement: explicit ${response.status}; no migration requested.`,
  );
}
for (const route of [
  "/",
  "/security",
  "/protocol/v2",
  "/agent",
  "/favicon.svg",
  "/r/AAAAAAAAAAAAAAAAAAAAAA",
  "/r/AAAAAAAAAAAAAAAAAAAAAA/agent",
]) {
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(origin + route, { redirect: "error" });
    if (response.ok || (response.status !== 404 && response.status < 500))
      break;
    if (attempt < 3)
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  check(response.ok, `Public route failed: ${route}`);
  check(
    response.headers.get("Referrer-Policy") === "no-referrer",
    `Missing privacy headers: ${route}`,
  );
}
for (const retired of ["/v1/rooms", "/protocol/v1"])
  check(
    (await fetch(origin + retired)).status === 410,
    "v1 is not explicitly retired.",
  );
const apiMiss = await fetch(origin + "/v2/missing");
check(
  apiMiss.status === 404 &&
    apiMiss.headers.get("Content-Type")?.includes("application/json"),
  "API miss returned incorrect status/HTML.",
);
const created = cli(["create", "--relay", origin, "--ttl", "14", "--json"]);
const url = new URL(created.url),
  id = url.pathname.split("/").at(-1),
  params = new URLSearchParams(url.hash.slice(1));
const headers = { Authorization: `Bearer ${params.get("a")}` };
const meta = await fetch(`${origin}/v2/rooms/${id}`, { headers });
check(
  meta.ok && meta.headers.get("Cache-Control") === "no-store",
  "Authenticated metadata/privacy failed.",
);
const marker = "AgentRoom v2 live smoke " + new Date().toISOString(),
  dir = await mkdtemp(join(tmpdir(), "agentroom-live-"));
try {
  const text = join(dir, "result.md"),
    attachment = join(dir, "table.csv"),
    output = join(dir, "download.csv");
  const bytes = Buffer.from("name,value\nSynthetic,42\n");
  await writeFile(text, marker);
  await writeFile(attachment, bytes);
  const first = cli(
    [
      "publish",
      "--invite-stdin",
      "--file",
      text,
      "--attach",
      attachment,
      "--actor",
      "Smoke A",
      "--json",
    ],
    created.url,
    "a",
  );
  await writeFile(text, "Independent second profile response");
  const second = cli(
    [
      "publish",
      "--invite-stdin",
      "--file",
      text,
      "--actor",
      "Smoke B",
      "--json",
    ],
    created.url,
    "b",
  );
  const read = cli(["read", "--invite-stdin", "--json"], created.url);
  check(
    read.events.length === 2 && read.events[0].payload.body === marker,
    "Signed encrypted roundtrip failed.",
  );
  check(
    first.seq === 1 && second.seq === 2 && first.actor.id !== second.actor.id,
    "Sequence/identity mismatch.",
  );
  const downloaded = cli(
    [
      "download",
      "--invite-stdin",
      "--blob",
      first.attachments[0],
      "--out",
      output,
      "--json",
    ],
    created.url,
    "b",
  );
  check(
    downloaded.saved && (await readFile(output)).equals(bytes),
    "Independent file decryption is not byte-identical.",
  );
  const incremental = cli(
    ["read", "--invite-stdin", "--after", "1", "--json"],
    created.url,
  );
  check(incremental.events.length === 1, "Incremental read failed.");
  const raw = await (
    await fetch(`${origin}/v2/rooms/${id}/events`, { headers })
  ).text();
  for (const secret of [marker, "Smoke A", "table.csv", params.get("k")])
    check(!raw.includes(secret), "Plaintext/key leaked in relay response.");
  await writeFile(
    statePath,
    JSON.stringify({ origin, url: created.url, marker }),
    { mode: 0o600 },
  );
  console.log(
    "Live v2: 7 public routes, retired v1, privacy headers, two signed participants, encrypted CSV upload/download, incremental reads and ciphertext-only relay passed.",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
