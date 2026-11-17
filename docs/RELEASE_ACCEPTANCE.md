# V0 release acceptance

## Delivered source and public test surface

- New project: `/Users/hagen/Projects/agentroom`.
- Public canonical repository: https://github.com/h4gen/agentroom (`main`, MIT).
- Isolated test deployment: https://agentroom-v0.hagen-hoferichter.workers.dev
- Pinned standalone CLI: https://github.com/h4gen/agentroom/releases/tag/v0.1.0
- The original decorative layout was rejected and replaced at the user's request with React/Radix UI, neutral black/white, system type and blue as the only accent. There is no marketing hero, illustration, remote font or tracking SDK.

## Automated and live checks

17 protocol/Workers-runtime tests: independent Python AES-GCM vectors and reverse decryption, nonce/ID freshness, invitation parsing, secret exclusion from HTTP/storage, immutable retry bytes, actual SQLite concurrency and quotas, pagination, auth/errors, alarm cleanup, no persistent schema creation on unknown-room GET, and persistence over full runtime restart.

Four browser tests: desktop/mobile browser ↔ standalone CLI exchange, initial message, CLI response, browser follow-up, refresh/reload, exclusive cursor reads, inert HTML/script content, tampered/wrong-key event failure with persistent warning, no extra key/plaintext localStorage, no K in HTTP, no browser/CSP errors, generic previews, protocol discovery and strict response headers. All four also passed against the live test deployment.

Independent release download hash matches the local artifact. GitHub CI passed for canonical code. Live smoke verified five retained public routes, API JSON errors, private headers, ciphertext-only responses, two-process encrypted read/write and incremental fetch. A subsequent smoke verified the previously accepted room remains readable.

The very first immediate smoke after initial Cloudflare deployment briefly failed public-route readiness; a subsequent independent request and complete smoke/browser run passed. Public readiness checks now have bounded retries for propagation; missing retained room data is never silently ignored.

## Provider acceptance and remaining ownership

See [PLATFORM_TEST_MATRIX.md](PLATFORM_TEST_MATRIX.md) for actual account runs, blockers and manual-case status. Browser/CLI success alone is never described as proved Work/Cowork compatibility. Only synthetic data is used; complete invitations and test traces remain local/ignored.

ChatGPT Work also passed a real ten-event/cursor/retry/injection scenario, with its encrypted seq 11 result independently verified. The owner must explicitly approve the narrow Claude domain allowlist change before the agent can alter that security setting. A true 24-hour resume check remains pending until 18 November 2026, 14:33 CET; the locally saved fixture has 14-day retention so it will still be valid then. No broad public pilot or file-artifact milestone is claimed.

Only this project's owned files were changed. No feature worktrees were created. Generated builds, dependencies, local browser traces and synthetic acceptance invitations are ignored and retained locally for reproducibility; no owned unmerged feature branch is left behind.
