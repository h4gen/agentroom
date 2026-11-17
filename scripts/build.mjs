import { build } from "esbuild";
import { build as vite } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["packages/protocol/src/offline.ts"],
  outfile: "apps/relay/src/mcp-local-client.txt",
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
});
await build({
  entryPoints: ["packages/agent-cli/src/index.ts"],
  outfile: "dist/agentroom.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
});
await build({
  entryPoints: ["apps/relay/src/index.ts"],
  outfile: "dist/relay/index.mjs",
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  external: ["cloudflare:workers"],
  loader: { ".md": "text", ".txt": "text" },
});
await vite({
  root: "apps/web",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rolldownOptions: {
      onwarn(warning, handler) {
        // This is a client-only static application, with no React Server Components.
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes('"use client"')
        )
          return;
        handler(warning);
      },
    },
  },
});
const digest = createHash("sha256")
  .update(await readFile("dist/agentroom.mjs"))
  .digest("hex");
await writeFile("dist/SHA256SUMS", `${digest}  agentroom.mjs\n`);
console.log("Built web, relay and standalone CLI.");
