# AgentRoom V0 — accepted implementation plan

Accepted 17 November 2026. Source: PRD.md. Deliver in a new folder /Users/hagen/Projects/agentroom, public h4gen/agentroom GitHub repository, MIT, canonical main, isolated Cloudflare testdeployment. English UI/docs; German planning. No modifications to other repositories.

## Delivery sequence

1. Establish TypeScript/pnpm workspace and docs, then probe actual provider execution/network capability.
2. Shared crypto/client + Worker/SQLite Durable Object + single-file Node CLI; prove independent encrypted roundtrip.
3. Minimal responsive browser creation/view/publication, private invitation copying, public protocol bootstrap and honest trust UX.
4. Automated independent crypto, actual Workers/SQLite API, persistence/expiry and desktop/mobile browser/CLI tests.
5. Publish canonical source/release, deploy cumulative main, verify live retained/new behavior, then test actual Work/Cowork handoff.

## Explicit decisions

V0 messages only, no R2 artifacts, auth accounts, connectors, cloud LLM, MCP/WebMCP/A2A, schedules, push, identity or key rotation. V0.1 files remain a separate milestone. Node >=22.12 replaces PRD's unsupported Node 20 baseline. Browser no framework, no remote fonts/assets, no persistent plaintext/key cache. On provider limitation, finish technical V0 and mark the exact provider path blocked/unverified.

Room TTL integer 1–30 days, default 14; 2,000 events, 64 KiB/event, 100/page. Exact request bytes define retry idempotency; duplicate success is 200 and new insertion 201. The client retries at most three times with unchanged bytes. Post-expiry 410 before cleanup, 404 after cleanup. Hash-only capability storage; K never enters HTTP.

Automated tests distinguish technical browser/CLI compatibility from actual provider acceptance. Manual tests: both sender roles, 24-hour resume, ten events/retry/restart, and malicious sharing request with a private canary. Count network approvals and account/runtime constraints. Never claim a manual test passed if not observed.

## Completion and release integrity

All accepted work must be integrated on main after fresh remote fetch. Inspect concurrent worktrees/branches and accepted/live behavior. Never stage another task's files. Deploy only cumulative main, verify retained room data and all existing routes after update, and report commit, live URL, checks and outstanding ownership. A preview/branch deployment alone is incomplete.

## Changes from PRD implementation sketch

The common package includes an HTTP client as well as crypto so retries/URL handling cannot drift between browser and CLI. Integration tests use Miniflare's actual Workers/SQLite runtime under Vitest rather than a mocked database. An independent Python AES-GCM vector checker is included as a dev tool; a Python agent runtime client is added only if a real provider lacks suitable Node support. Versioned pinned GitHub release delivery is used, with no npm publishing dependency.
