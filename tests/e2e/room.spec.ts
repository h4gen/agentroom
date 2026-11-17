import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  decrypt,
  encrypt,
  message,
  parseInvite,
  randomSecret,
} from "../../packages/protocol/src/index.ts";
// The suite models several independent agents from one IP. Preserve production
// limits and stagger projects rather than weakening the limiter for acceptance.
test.beforeAll(async ({}, info) => {
  test.setTimeout(75_000);
  if (info.project.name === "mobile")
    await new Promise((resolve) => setTimeout(resolve, 60_000));
});
function cli(args: string[], input?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["dist/agentroom.mjs", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENTROOM_PROFILE_DIR: join(
          tmpdir(),
          `agentroom-e2e-profiles-${process.pid}`,
        ),
      },
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
test("read-only room, both connect modals, ciphertext agent updates, XSS and retained history", async ({
  page,
  baseURL,
}) => {
  const captured: string[] = [],
    writes: string[] = [],
    browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() === "error") browserErrors.push(entry.text());
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL!)) return;
    captured.push(
      JSON.stringify({
        url: request.url(),
        headers: request.headers(),
        body: request.postData(),
      }),
    );
    if (request.method() === "POST")
      writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  await expect(page.getByLabel("First message")).toHaveCount(0);
  await expect(page.getByLabel("Your display name")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Expires after" }).selectOption("7");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(
    page.getByText("No agent activity yet. Connect an agent to start."),
  ).toBeVisible();
  const url = page.url(),
    invite = parseInvite(url);
  expect(invite.origin).toBe(baseURL);
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(
    0,
  );
  await expect(
    page.locator("textarea:not([readonly]),input:not([readonly])"),
  ).toHaveCount(0);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: baseURL!,
  });
  await page
    .context()
    .route("https://claude.ai/**", (route) =>
      route.fulfill({ body: "External settings navigation test" }),
    );

  const gptButton = page.getByRole("button", {
    name: "Connect with GPT",
    exact: true,
  });
  await gptButton.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Connect with GPT", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Connect prompt")).toHaveValue(
    new RegExp(invite.roomId),
  );
  const gptURL = new URL(
    (await dialog
      .getByRole("link", { name: "Open in ChatGPT", exact: true })
      .getAttribute("href"))!,
  );
  expect(gptURL.origin).toBe("https://chatgpt.com");
  expect(gptURL.searchParams.get("q")).toContain(url);
  await dialog
    .getByRole("button", { name: "Copy connect prompt", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Prompt copied", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    url,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(gptButton).toBeFocused();

  await page
    .getByRole("button", { name: "Connect with Claude", exact: true })
    .click();
  await expect(dialog.getByText("Step 1 of 3", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Website to allow")).toHaveValue(
    new URL(baseURL!).hostname,
  );
  await expect(dialog.getByLabel("Connect prompt")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Copy domain", exact: true })
    .click();
  await expect(dialog.getByText("Step 2 of 3", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    new URL(baseURL!).hostname,
  );
  const settings = dialog.getByRole("link", {
    name: "Open Claude settings",
    exact: true,
  });
  await expect(settings).toHaveAttribute(
    "href",
    "https://claude.ai/new#settings/capabilities/allowed-websites",
  );
  await expect(settings).toHaveAttribute("rel", "noopener noreferrer");
  await expect(
    dialog.getByRole("button", { name: "I added the website", exact: true }),
  ).toBeDisabled();
  const popup = page.waitForEvent("popup");
  await settings.click();
  await (await popup).close();
  await page.bringToFront();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    new URL(baseURL!).hostname,
  );
  await dialog
    .getByRole("button", { name: "I added the website", exact: true })
    .click();
  await expect(dialog.getByText("Step 3 of 3", { exact: true })).toBeVisible();
  const claudeURL = new URL(
    (await dialog
      .getByRole("link", { name: "Open in Claude", exact: true })
      .getAttribute("href"))!,
  );
  expect(claudeURL.searchParams.get("q")).toContain(url);
  await dialog
    .getByRole("button", { name: "Copy connect prompt", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    url,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect with Claude", exact: true })
    .click();
  await expect(dialog.getByText("Step 1 of 3", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Already set up", exact: true })
    .click();
  await expect(dialog.getByText("Step 3 of 3", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog.getByText("Step 2 of 3", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const dir = await mkdtemp(join(tmpdir(), "agentroom-e2e-"));
  try {
    const first = "AGENT_PRIVATE_CANARY_🍃",
      file = join(dir, "reply.md");
    await writeFile(file, first);
    await cli(
      [
        "publish",
        "--invite-stdin",
        "--file",
        file,
        "--actor",
        "Agent A",
        "--json",
      ],
      url,
    );
    await expect(page.locator(".message-body")).toHaveText(first, {
      timeout: 15000,
    });
    const response = await page.request.get(
      `/v2/rooms/${invite.roomId}/events`,
      { headers: { Authorization: `Bearer ${invite.access}` } },
    );
    expect(
      (
        await decrypt(
          invite.roomId,
          invite.key,
          (await response.json()).events[0],
        )
      ).body,
    ).toBe(first);
    const second = "<script>window.STOLEN=true</script> Agent B reply";
    await writeFile(file, second);
    await cli(
      [
        "publish",
        "--invite-stdin",
        "--file",
        file,
        "--actor",
        "Agent B",
        "--json",
      ],
      url,
    );
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator(".message-body").last()).toHaveText(second);
    const continued = await cli(["read", "--invite-stdin", "--json"], url);
    expect(continued.events[1].payload.actor.id).toBe(
      continued.events[0].payload.actor.id,
    );
    expect(await page.locator("#messages script").count()).toBe(0);
    await page.reload();
    await expect(page.locator(".message-body")).toHaveCount(2);
    expect(
      (await cli(["read", "--invite-stdin", "--after", "1", "--json"], url))
        .events[0].payload.body,
    ).toBe(second);
    const event = await encrypt(
      invite.roomId,
      randomSecret(),
      message("unreadable canary"),
    );
    await page.request.post(`/v2/rooms/${invite.roomId}/events`, {
      headers: { Authorization: `Bearer ${invite.access}` },
      data: event,
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Some events could not be decrypted",
    );
    await expect(page.locator(".message-body").last()).toContainText(
      "Cannot verify",
    );
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Some events could not be decrypted",
    );
    expect(captured.join("\n")).not.toContain(first);
    expect(captured.join("\n")).not.toContain("Agent A");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  expect(writes).toEqual(["/v2/rooms"]);
  expect(captured.join("\n")).not.toContain(invite.key);
  expect(captured.join("\n")).not.toContain("#k=");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(browserErrors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("clipboard denial leaves both connect prompts selectable without opening a provider", async ({
  page,
  baseURL,
}) => {
  const room = await cli([
    "create",
    "--relay",
    baseURL!,
    "--ttl",
    "1",
    "--json",
  ]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Denied");
        },
      },
    });
  });
  await page.goto(room.url);
  await page
    .getByRole("button", { name: "Connect with GPT", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Copy connect prompt", exact: true })
    .click();
  await expect(
    dialog.getByText("Copy the selected prompt manually.", { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Connect prompt")).toBeFocused();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Connect with Claude", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Copy domain", exact: true })
    .click();
  await expect(dialog.getByLabel("Website to allow")).toBeFocused();
  await dialog
    .getByRole("button", { name: "I copied the domain", exact: true })
    .click();
  await expect(dialog.getByText("Step 2 of 3", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("public trust pages, missing fragment, generic preview and strict headers", async ({
  page,
}) => {
  const response = await page.goto("/security");
  const nonce = await page
    .locator('meta[name="style-nonce"]')
    .getAttribute("content");
  expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(response?.headers()["content-security-policy"]).toContain(
    `'nonce-${nonce}'`,
  );
  expect(response?.headers()["content-security-policy"]).not.toContain(
    "unsafe-inline",
  );
  const nextHtml = await page.request.get("/security");
  expect(await nextHtml.text()).not.toContain(`content="${nonce}"`);
  expect((await page.request.head("/security")).status()).toBe(200);
  expect(await (await page.request.get("/index.html")).text()).toContain(
    'name="style-nonce"',
  );
  await expect(
    page.getByRole("heading", { name: "Security & privacy" }),
  ).toBeVisible();
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["content-security-policy"]).toContain(
    "connect-src 'self'",
  );
  await page.goto("/r/AAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByRole("status")).toContainText("complete invitation");
  await expect(
    page.getByRole("button", { name: "Connect with GPT", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.locator('meta[property="og:title"]').getAttribute("content"),
  ).toContain("AgentRoom");
  const protocol = await page.request.get("/protocol/v2");
  expect(protocol.status()).toBe(200);
  expect(await protocol.text()).toContain("agentroom/v2|event|");
  const guide = await page.request.get("/agent");
  expect(guide.status()).toBe(200);
  expect(await guide.text()).toContain("fewest");
  expect(await guide.text()).toContain("Interactive browser route");
  const missing = await page.request.get("/v2/missing");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
});

test.afterAll(async () => {
  await rm(join(tmpdir(), `agentroom-e2e-profiles-${process.pid}`), {
    recursive: true,
    force: true,
  });
});

test("browser-only signed contributions, immutable file exchange, identity continuity and readonly downloads", async ({
  page,
  browser,
  baseURL,
}) => {
  const room = await cli([
    "create",
    "--relay",
    baseURL!,
    "--ttl",
    "1",
    "--json",
  ]);
  const invite = parseInvite(room.url),
    agentURL = new URL(room.url);
  agentURL.pathname += "/agent";
  const requests: string[] = [],
    postBodies: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  page.on("request", (r) => {
    if (r.url().startsWith(baseURL!))
      requests.push(
        JSON.stringify({
          url: r.url(),
          headers: r.headers(),
          body: r.postData(),
        }),
      );
  });
  let dropped = false;
  await page.route("**/v2/rooms/*/events", async (route) => {
    if (route.request().method() === "POST") {
      postBodies.push(route.request().postData()!);
      if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await page.goto(agentURL.href);
  await expect(
    page.getByLabel("Display name", { exact: false }),
  ).not.toHaveValue("");
  await page.getByLabel("Display name", { exact: false }).fill("Shared name");
  await page
    .getByLabel("Contribution", { exact: true })
    .fill("BROWSER_BODY_CANARY_42");
  const csv = Buffer.from("name,value\nGrüße,42\n"),
    pdf = Buffer.from("%PDF-1.7\nsynthetic acceptance only\n");
  await page.getByLabel("Attachments", { exact: false }).setInputFiles([
    { name: "BROWSER_FILE_CANARY.csv", mimeType: "text/csv", buffer: csv },
    { name: "report<script>.pdf", mimeType: "application/pdf", buffer: pdf },
  ]);
  await page
    .getByRole("button", { name: "Publish contribution", exact: true })
    .click();
  await expect(page.getByText("Published and verified · #1")).toBeVisible();
  expect(postBodies.length).toBe(2);
  expect(postBodies[0]).toBe(postBodies[1]);
  const first = await cli(["read", "--invite-stdin", "--json"], room.url);
  expect(first.events).toHaveLength(1);
  expect(first.events[0].payload.attachments).toHaveLength(2);
  const id = first.events[0].payload.actor.id;
  const dir = await mkdtemp(join(tmpdir(), "agentroom-files-e2e-"));
  try {
    const out = join(dir, "result.csv");
    const download = await cli(
      [
        "download",
        "--invite-stdin",
        "--blob",
        first.events[0].payload.attachments[0].blob_id,
        "--out",
        out,
        "--json",
      ],
      room.url,
    );
    expect(download.saved).toBe(true);
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(out)).toEqual(csv);
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: false })).toHaveValue(
      "Shared name",
    );
    await page
      .getByLabel("Contribution", { exact: true })
      .fill("same identity after reload");
    await page
      .getByRole("button", { name: "Publish contribution", exact: true })
      .click();
    await expect(page.getByText("Published and verified · #2")).toBeVisible();
    const again = await cli(["read", "--invite-stdin", "--json"], room.url);
    expect(again.events[1].payload.actor.id).toBe(id);
    const secondContext = await browser.newContext();
    try {
      const other = await secondContext.newPage();
      await other.goto(agentURL.href);
      await expect(
        other.getByLabel("Display name", { exact: false }),
      ).not.toHaveValue("");
      await other
        .getByLabel("Display name", { exact: false })
        .fill("Shared name");
      await other
        .getByLabel("Contribution", { exact: true })
        .fill("independent browser participant");
      await other
        .getByRole("button", { name: "Publish contribution", exact: true })
        .click();
      await expect(
        other.getByText("Published and verified · #3"),
      ).toBeVisible();
    } finally {
      await secondContext.close();
    }
    const third = await cli(["read", "--invite-stdin", "--json"], room.url);
    expect(third.events[2].payload.actor.id).not.toBe(id);
    const temporaryContext = await browser.newContext();
    try {
      await temporaryContext.addInitScript(() => {
        Object.defineProperty(window, "indexedDB", {
          get() {
            throw new Error("Storage denied");
          },
        });
      });
      const temporary = await temporaryContext.newPage();
      await temporary.goto(agentURL.href);
      await expect(
        temporary.getByText("temporary in this browser", { exact: false }),
      ).toBeVisible();
      await temporary
        .getByLabel("Contribution", { exact: true })
        .fill("temporary identity without setup");
      await temporary
        .getByRole("button", { name: "Publish contribution", exact: true })
        .click();
      await expect(
        temporary.getByText("Published and verified · #4"),
      ).toBeVisible();
    } finally {
      await temporaryContext.close();
    }
    const responseFile = join(dir, "response.md"),
      pdfFile = join(dir, "review.pdf");
    await writeFile(responseFile, "CLI reviewed the browser result");
    await writeFile(pdfFile, pdf);
    const reply = await cli(
      [
        "publish",
        "--invite-stdin",
        "--file",
        responseFile,
        "--attach",
        pdfFile,
        "--actor",
        "CLI Reviewer",
        "--json",
      ],
      room.url,
    );
    expect(reply.seq).toBe(5);
    expect(reply.actor.id).not.toBe(id);
    await page.goto(room.url);
    await expect(page.locator(".message")).toHaveCount(5);
    await expect(
      page.locator("textarea:not([readonly]),input:not([readonly])"),
    ).toHaveCount(0);
    await expect(
      page.locator("iframe,object,embed,#messages script"),
    ).toHaveCount(0);
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Download BROWSER_FILE_CANARY.csv",
        exact: true,
      })
      .click();
    const saved = await downloaded;
    expect(saved.suggestedFilename()).toBe("BROWSER_FILE_CANARY.csv");
    expect(await readFile((await saved.path())!)).toEqual(csv);
    const pdfDownloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download review.pdf", exact: true })
      .click();
    expect(await readFile((await (await pdfDownloaded).path())!)).toEqual(pdf);
    for (const secret of [
      invite.key,
      "BROWSER_BODY_CANARY_42",
      "BROWSER_FILE_CANARY",
      "Shared name",
      "name,value",
    ])
      expect(requests.join("\n")).not.toContain(secret);
    expect(errors.filter((e) => !e.includes("net::ERR_FAILED"))).toEqual([]);
    if (baseURL?.startsWith("https://"))
      await page.screenshot({
        path: `.wrangler/v2-room-${page.viewportSize()!.width < 600 ? "mobile" : "desktop"}.png`,
        fullPage: true,
      });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
