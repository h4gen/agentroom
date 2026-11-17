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
const cli = (args, input) => {
  const result = spawnSync(process.execPath, ["dist/agentroom.mjs", ...args], {
    input,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0)
    throw new Error(
      `CLI smoke failed (${result.status}); invitation suppressed.`,
    );
  return JSON.parse(result.stdout);
};
await mkdir(".wrangler", { recursive: true });
const statePath = ".wrangler/accepted-smoke.local";
let previous;
try {
  previous = JSON.parse(await readFile(statePath, "utf8"));
} catch {}
if (previous?.origin === origin) {
  const old = cli(["read", "--invite-stdin", "--json"], previous.url);
  check(
    old.events.some((e) => e.payload?.body === previous.marker),
    "Previously accepted room content is missing.",
  );
  console.log("Retained accepted room: passed.");
}
for (const route of [
  "/",
  "/security",
  "/protocol/v1",
  "/agent",
  "/favicon.svg",
  "/r/AAAAAAAAAAAAAAAAAAAAAA",
]) {
  let response;
  // A brand-new workers.dev route can briefly return 404 during propagation.
  // Bound retries to public-route readiness; retained room data must still pass immediately.
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
const apiMiss = await fetch(origin + "/v1/missing");
check(apiMiss.status === 404, "API route miss is not 404.");
check(
  apiMiss.headers.get("Content-Type")?.includes("application/json"),
  "API miss returned HTML.",
);
const created = cli(["create", "--relay", origin, "--ttl", "1", "--json"]);
const url = new URL(created.url),
  access = new URLSearchParams(url.hash.slice(1)).get("a");
const headers = { Authorization: `Bearer ${access}` };
const meta = await fetch(
  origin + "/v1/rooms/" + url.pathname.split("/").at(-1),
  { headers },
);
check(meta.ok, "Authenticated metadata failed.");
check(
  meta.headers.get("Cache-Control") === "no-store",
  "Private metadata is cacheable.",
);
const marker = "AgentRoom live smoke " + new Date().toISOString();
const dir = await mkdtemp(join(tmpdir(), "agentroom-live-"));
try {
  const file = join(dir, "result.md");
  await writeFile(file, marker);
  const first = cli(
    [
      "publish",
      "--invite-stdin",
      "--file",
      file,
      "--actor",
      "Smoke A",
      "--json",
    ],
    created.url,
  );
  await writeFile(file, "Independent second process response");
  const second = cli(
    [
      "publish",
      "--invite-stdin",
      "--file",
      file,
      "--actor",
      "Smoke B",
      "--json",
    ],
    created.url,
  );
  const read = cli(["read", "--invite-stdin", "--json"], created.url);
  check(
    read.events.length === 2 && read.events[0].payload.body === marker,
    "Encrypted roundtrip failed.",
  );
  check(first.seq === 1 && second.seq === 2, "Sequence mismatch.");
  const incremental = cli(
    ["read", "--invite-stdin", "--after", "1", "--json"],
    created.url,
  );
  check(incremental.events.length === 1, "Incremental read failed.");
  const raw = await (
    await fetch(
      origin + "/v1/rooms/" + url.pathname.split("/").at(-1) + "/events",
      { headers },
    )
  ).text();
  check(
    !raw.includes(marker) && !raw.includes("Smoke A"),
    "Plaintext leaked in relay response.",
  );
  const key = new URLSearchParams(url.hash.slice(1)).get("k");
  check(!raw.includes(key), "Key leaked in relay response.");
  await writeFile(
    statePath,
    JSON.stringify({ origin, url: created.url, marker }),
    { mode: 0o600 },
  );
  console.log(
    "Live checks: 6 public routes, API errors/privacy headers, ciphertext-only response, two-process encrypted roundtrip and incremental reads passed.",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
