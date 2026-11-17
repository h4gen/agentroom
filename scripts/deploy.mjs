import { execFileSync } from "node:child_process";
const read = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}
try {
  if (read("branch", "--show-current") !== "main")
    throw new Error("Deploy only canonical main.");
  if (read("status", "--porcelain"))
    throw new Error(
      "Commit/integrate owned changes first. Deployment requires a clean checkout.",
    );
  run("git", ["fetch", "origin"]);
  if (read("rev-parse", "HEAD") !== read("rev-parse", "origin/main"))
    throw new Error(
      "HEAD differs from freshly fetched origin/main. Integrate and push first.",
    );
  console.log("Canonical commit: " + read("rev-parse", "HEAD"));
  console.log(read("worktree", "list"));
  run("pnpm", [
    "exec",
    "wrangler",
    "r2",
    "bucket",
    "info",
    "agentroom-v2-files",
  ]);
  run("pnpm", ["check"]);
  run("pnpm", ["test:vectors"]);
  // Recheck after tests in case another task advanced main while they ran.
  run("git", ["fetch", "origin"]);
  if (
    read("rev-parse", "HEAD") !== read("rev-parse", "origin/main") ||
    read("status", "--porcelain")
  )
    throw new Error(
      "Canonical source changed during verification. Integrate before deployment.",
    );
  run("pnpm", ["exec", "wrangler", "deploy"]);
  run(process.execPath, ["scripts/smoke.mjs"]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
