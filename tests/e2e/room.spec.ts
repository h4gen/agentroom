import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  decrypt,
  encrypt,
  message,
  parseInvite,
  randomSecret,
} from "../../packages/protocol/src/index.ts";
function cli(args: string[], input?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["dist/agentroom.mjs", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.stdin.end(input);
    p.on("error", reject);
    p.on("close", (code) =>
      code
        ? reject(new Error(`CLI failed (${code}): ${err}`))
        : resolve(JSON.parse(out)),
    );
  });
}
test("browser ↔ standalone CLI: crypto, XSS, invitation secrecy, reload and incremental read", async ({
  page,
  baseURL,
}) => {
  const captured: string[] = [];
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() === "error") browserErrors.push(entry.text());
  });
  page.on("request", (r) =>
    captured.push(
      JSON.stringify({
        url: r.url(),
        headers: r.headers(),
        body: r.postData(),
      }),
    ),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A shared room for your agents." }),
  ).toBeVisible();
  await page.getByLabel("Your display name").fill("Browser Alice");
  await page.getByRole("combobox", { name: "Expires after" }).selectOption("7");
  const first = "BROWSER_PRIVATE_CANARY_🍃";
  await page.getByLabel("First message").fill(first);
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.locator(".message-body")).toHaveText(first);
  const invite = parseInvite(page.url()),
    url = page.url();
  expect(invite.origin).toBe(baseURL);
  const fromBrowser = await cli(["read", "--invite-stdin", "--json"], url);
  expect(fromBrowser.events[0].payload.body).toBe(first);
  // Node decrypts browser output independently, before trusting UI rendering.
  const response = await page.request.get(`/v1/rooms/${invite.roomId}/events`, {
    headers: { Authorization: `Bearer ${invite.access}` },
  });
  const raw = await response.json();
  expect((await decrypt(invite.roomId, invite.key, raw.events[0])).body).toBe(
    first,
  );
  const dir = await mkdtemp(join(tmpdir(), "agentroom-e2e-"));
  try {
    const text = "<script>window.STOLEN=true</script> CLI_PRIVATE_CANARY_Grüße";
    const file = join(dir, "reply.md");
    await writeFile(file, text);
    await cli(
      [
        "publish",
        "--invite-stdin",
        "--file",
        file,
        "--actor",
        "CLI Bob",
        "--json",
      ],
      url,
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator(".message-body").last()).toHaveText(text);
    expect(
      await page.evaluate(
        () => document.querySelectorAll("#messages script").length,
      ),
    ).toBe(0);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await page.reload();
    await expect(page.locator(".message-body")).toHaveCount(2);
    const incremental = await cli(
      ["read", "--invite-stdin", "--after", "1", "--json"],
      url,
    );
    expect(incremental.events).toHaveLength(1);
    expect(incremental.events[0].payload.body).toBe(text);
    await page.getByLabel("Message", { exact: true }).fill("Browser follow-up");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".message-body").last()).toHaveText(
      "Browser follow-up",
    );
    const followup = await cli(
      ["read", "--invite-stdin", "--after", "2", "--json"],
      url,
    );
    expect(followup.events[0].payload.body).toBe("Browser follow-up");
    const bad = { ...invite, key: randomSecret() };
    // Altered event is stored by a blind relay, then safely rejected by the client.
    const event = await encrypt(
      invite.roomId,
      bad.key,
      message("unreadable canary"),
    );
    await page.request.post(`/v1/rooms/${invite.roomId}/events`, {
      headers: { Authorization: `Bearer ${invite.access}` },
      data: event,
    });
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Some events could not be decrypted",
    );
    await expect(page.locator(".message-body").last()).toContainText(
      "Cannot decrypt",
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Some events could not be decrypted",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const sent = captured.join("\n");
  expect(sent).not.toContain(invite.key);
  expect(sent).not.toContain(first);
  expect(sent).not.toContain("Browser Alice");
  expect(sent).not.toContain("#k=");
  expect(browserErrors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("public trust pages, missing fragment, generic preview and strict headers", async ({
  page,
}) => {
  const response = await page.goto("/security");
  await expect(
    page.getByRole("heading", { name: "Security & privacy" }),
  ).toBeVisible();
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["content-security-policy"]).toContain(
    "connect-src 'self'",
  );
  await page.goto("/r/AAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByRole("status")).toContainText("complete invitation");
  expect(
    await page.locator('meta[property="og:title"]').getAttribute("content"),
  ).toContain("AgentRoom");
  expect(
    await page.locator('meta[property="og:title"]').getAttribute("content"),
  ).not.toContain("AAAA");
  const protocol = await page.request.get("/protocol/v1");
  expect(protocol.status()).toBe(200);
  expect(await protocol.text()).toContain("agentroom/v1|event|");
  const guide = await page.request.get("/agent");
  expect(guide.status()).toBe(200);
  expect(await guide.text()).toContain("fewest");
  expect(await guide.text()).toContain("Interactive browser route");
  const html = await page.request.get("/r/AAAAAAAAAAAAAAAAAAAAAA");
  expect(await html.text()).toContain('href="/agent"');
  const missing = await page.request.get("/v1/missing");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
});
