import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Use the host's configured network path, never invent a proxy or weaken TLS.
export function networkEnvironment(
  env: NodeJS.ProcessEnv,
  supportsProxy: boolean,
  execArgv: string[],
): NodeJS.ProcessEnv | undefined {
  const proxy =
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!proxy || !supportsProxy) return undefined;
  // An explicit caller preference wins, including an opt-out.
  const explicit =
    env.NODE_USE_ENV_PROXY !== undefined ||
    execArgv.some((arg) => arg.includes("use-env-proxy")) ||
    env.NODE_OPTIONS?.includes("use-env-proxy");
  const ca =
    !env.NODE_EXTRA_CA_CERTS && (env.SSL_CERT_FILE || env.REQUESTS_CA_BUNDLE);
  const extraCA = ca && existsSync(ca) ? ca : undefined;
  const enable = !explicit;
  if (!enable && !extraCA) return undefined;
  return {
    ...env,
    ...(enable ? { NODE_USE_ENV_PROXY: "1" } : {}),
    ...(extraCA ? { NODE_EXTRA_CA_CERTS: extraCA } : {}),
  };
}

export function prepareNetwork() {
  const env = networkEnvironment(
    process.env,
    process.allowedNodeEnvironmentFlags.has("--use-env-proxy"),
    process.execArgv,
  );
  if (!env) return;
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, ...process.argv.slice(1)],
    { env, stdio: "inherit" },
  );
  // No key is generated and no stdin consumed in the parent before delegation.
  process.exit(child.status ?? 1);
}
