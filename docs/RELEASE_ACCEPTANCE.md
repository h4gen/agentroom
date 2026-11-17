# V0 release acceptance

## Delivered source and public test surface

- New project: `/Users/hagen/Projects/agentroom`.
- Public canonical repository: https://github.com/h4gen/agentroom (`main`, MIT).
- Isolated test deployment: https://agentroom-v0.hagen-hoferichter.workers.dev
- Pinned standalone CLI: https://github.com/h4gen/agentroom/releases/tag/v0.1.1
- The original decorative layout was rejected and replaced at the user's request with React/Radix UI, neutral black/white, system type and blue as the only accent. There is no marketing hero, illustration, remote font or tracking SDK.

## Automated and live checks

19 protocol/network/Workers-runtime tests: independent Python AES-GCM vectors and reverse decryption, nonce/ID freshness, invitation parsing, secret exclusion from HTTP/storage, immutable retry bytes, actual SQLite concurrency and quotas, pagination, auth/errors, alarm cleanup, no persistent schema creation on unknown-room GET, and persistence over full runtime restart.

Four browser tests: desktop/mobile browser ↔ standalone CLI exchange, initial message, CLI response, browser follow-up, refresh/reload, exclusive cursor reads, inert HTML/script content, tampered/wrong-key event failure with persistent warning, no extra key/plaintext localStorage, no K in HTTP, no browser/CSP errors, generic previews, protocol discovery and strict response headers. All four also passed against the live test deployment.

Independent release download hash matches the local artifact. GitHub CI passed for canonical code. Live smoke verified six retained public routes (including the added /agent entry), API JSON errors, private headers, ciphertext-only responses, two-process encrypted read/write and incremental fetch. A subsequent smoke verified the previously accepted room remains readable.

The very first immediate smoke after initial Cloudflare deployment briefly failed public-route readiness; a subsequent independent request and complete smoke/browser run passed. Public readiness checks now have bounded retries for propagation; missing retained room data is never silently ignored.

## Provider acceptance and remaining ownership

See [PLATFORM_TEST_MATRIX.md](PLATFORM_TEST_MATRIX.md) for actual account runs, blockers and manual-case status. Browser/CLI success alone is never described as proved Work/Cowork compatibility. Only synthetic data is used; complete invitations and test traces remain local/ignored.

ChatGPT Work also passed a real ten-event/cursor/retry/injection scenario, with its encrypted seq 11 result independently verified. The owner approved the narrow Claude allowlist entry; a fresh Claude recipient and the original Work sender completed the encrypted three-event roundtrip. This is Partial Go because one platform permission was needed. The adaptive browser/direct-client entry removes transport selection from the user and CLI v0.1.1 automates the observed proxy/CA setup. A true 24-hour resume check remains pending until 18 November 2026, 14:33 CET; the locally saved fixture has 14-day retention so it will still be valid then. No broad public pilot or file-artifact milestone is claimed.

Only this project's owned files were changed. No feature worktrees were created. Generated builds, dependencies, local browser traces and synthetic acceptance invitations are ignored and retained locally for reproducibility; no owned unmerged feature branch is left behind.

## Adaptive UX acceptance

Both access routes passed: a connected Codex browser completed create/read/write/readback entirely through the webclient; a fresh Claude session selected the direct route and used v0.1.1 without manual proxy flags, CA setup or user installation. Selection is guided by actual capability and additional user actions, not provider names. A web-only session with no browser connection cannot use the browser route; no universal permission bypass is claimed. The original three-contribution Work → Claude → Work roundtrip is independently verified.

Reverse-role acceptance also passed (Claude creates/publishes, Work receives only the invitation and replies). Both directions required no manual copying of work products; the Claude account's original one-time network permission is counted separately. The only elapsed-time acceptance item still open is the real 24-hour resume check.

## Provider prompt-prefill handoff

The room offers “Open in Claude”, generated locally from the complete invitation and the same authorized agent prompt as the copy action. A live browser test of https://claude.ai/new?q= with harmless synthetic text verified the composer is prefilled and the prompt is not automatically submitted. Claude also displays its own caution for URL-prefilled prompts. Anthropic documents prompt-prefill desktop links at https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link. No documented URL parameter for pre-populating the network domain allowlist was found; no one-click network-permission claim or unsupported setup parameter is shipped. The explicit provider handoff shares the private invitation with Claude, as stated beside the action.

## Network setup clarification

The requested setup concerns the existing relay-domain entry under Claude's Allowed websites, not an MCP connector. An incorrectly scoped MCP addition was fully reverted in canonical commit 56952c2 and redeployed; its setup dialog was cancelled without saving a connector. No MCP dependency, route or tool remains in the product.

The live Claude UI's Manage action navigates to `https://claude.ai/new#settings/capabilities/allowed-websites`. The saved narrow relay-domain entry is still present, and the base policy remains Standard download sites only. A supported domain-prefill parameter has not been established by the official documentation or the observed UI. Do not claim it exists or infer that connector URL parameters apply to this setting.

The room's Configure Claude action opens that exact setting and copies only the relay hostname to the clipboard. The user still pastes it into Add a website and confirms Add. This is a navigation/clipboard shortcut, not automatic domain prefill or permission granting. The UI states that limitation; blocked clipboard access exposes the public hostname for manual copying. Room secrets are never included in this setup destination or clipboard operation. Existing Open in Claude, copy invitation/instructions, browser and direct-client routes remain supported.
