import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { networkEnvironment } from "../packages/agent-cli/src/network.ts";

describe("automatic use of the host network configuration", () => {
  it("preserves explicit settings, respects unsupported runtimes and carries an existing CA path", () => {
    expect(networkEnvironment({}, true, [])).toBeUndefined();
    expect(
      networkEnvironment({ HTTPS_PROXY: "http://127.0.0.1:9" }, false, []),
    ).toBeUndefined();
    expect(
      networkEnvironment(
        { HTTPS_PROXY: "http://127.0.0.1:9", NODE_USE_ENV_PROXY: "0" },
        true,
        [],
      ),
    ).toBeUndefined();
    expect(
      networkEnvironment({ HTTPS_PROXY: "http://127.0.0.1:9" }, true, [
        "--use-env-proxy",
      ]),
    ).toBeUndefined();
    const env = networkEnvironment(
      {
        HTTPS_PROXY: "http://127.0.0.1:9",
        SSL_CERT_FILE: "tests/vectors/requirements.txt",
      },
      true,
      [],
    );
    expect(env?.NODE_USE_ENV_PROXY).toBe("1");
    expect(env?.NODE_EXTRA_CA_CERTS).toBe("tests/vectors/requirements.txt");
    expect(env?.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(networkEnvironment({ ...env! }, true, [])).toBeUndefined();
  });
  it.skipIf(!process.allowedNodeEnvironmentFlags.has("--use-env-proxy"))(
    "the standalone CLI actually sends through the configured proxy without caller flags",
    async () => {
      const requests: { url: string | undefined; body: string }[] = [];
      let tunnels = 0;
      const target = createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        requests.push({ url: req.url, body });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            room_id: "AAAAAAAAAAAAAAAAAAAAAA",
            protocol: 1,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }),
        );
      });
      await new Promise<void>((resolve) =>
        target.listen(0, "127.0.0.1", resolve),
      );
      const targetPort = (target.address() as { port: number }).port;
      const proxy = createServer((_req, res) => {
        res.writeHead(502);
        res.end();
      });
      proxy.on("connect", (_req, socket, head) => {
        tunnels++;
        const remote = connect(targetPort, "127.0.0.1", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) remote.write(head);
          socket.pipe(remote);
          remote.pipe(socket);
        });
        remote.on("error", () => socket.destroy());
        socket.on("close", () => remote.destroy());
      });
      await new Promise<void>((resolve) =>
        proxy.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = proxy.address() as { port: number };
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          HTTP_PROXY: `http://127.0.0.1:${address.port}`,
          HTTPS_PROXY: `http://127.0.0.1:${address.port}`,
          NO_PROXY: "",
        };
        delete env.NODE_USE_ENV_PROXY;
        delete env.http_proxy;
        delete env.https_proxy;
        delete env.no_proxy;
        const result = await new Promise<{
          code: number | null;
          out: string;
          err: string;
        }>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "dist/agentroom.mjs",
              "create",
              "--relay",
              `http://127.0.0.1:${targetPort}`,
              "--json",
            ],
            { env, stdio: ["pipe", "pipe", "pipe"] },
          );
          let out = "",
            err = "";
          child.stdout.on("data", (chunk) => (out += chunk));
          child.stderr.on("data", (chunk) => (err += chunk));
          child.stdin.end();
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, out, err }));
        });
        expect(result.code, result.err).toBe(0);
        expect(requests).toHaveLength(1);
        expect(tunnels).toBe(1);
        expect(requests[0].url).toBe("/v2/rooms");
        const created = JSON.parse(result.out);
        const key = new URLSearchParams(new URL(created.url).hash.slice(1)).get(
          "k",
        )!;
        expect(requests[0].body).not.toContain(key);
        expect(JSON.parse(requests[0].body).access_hash).toMatch(
          /^[A-Za-z0-9_-]{43}$/,
        );
      } finally {
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
        await new Promise<void>((resolve) => target.close(() => resolve()));
      }
    },
  );
});
