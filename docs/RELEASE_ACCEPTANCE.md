# v0.2.1 / protocol v2 acceptance

The v2 implementation adds automatic per-room signing identities, signed encrypted contributions, encrypted file attachments and a separate browser publishing view. The ordinary viewer remains read-only; GPT and Claude connection modals retain the approved flow. V1 is intentionally retired without migration or premature deletion of existing rooms.

## Verification

- 33 unit/runtime checks, eight desktop/mobile E2E scenarios and independent Python AES-GCM/Ed25519/file vectors. Tests include identity/name continuity, same-name distinct participants, concurrent local profile creation, exact retries after a dropped response, temporary browser storage fallback, byte-identical CSV/PDF downloads, full-size 10 MiB roundtrip, upload quotas and injected R2 put/get/delete/expiry failures.
- All eight browser scenarios also passed against the live v2 deployment after adding appropriate live-network assertion deadlines. No product rate limits were increased; project runs are staggered.
- Live smoke verified seven public routes, explicit v1 retirement, the previously accepted v1 room's unsupported-protocol response, privacy headers, two signed identities, encrypted CSV exchange and incremental reads. The old accepted room was independently read before the cut; its original expiry was retained.
- The 10 MiB live boundary test exposed a client deadline that was appropriate for messages but too short for large uploads. v0.2.1 gives file operations 120 seconds while ordinary API operations keep 20 seconds. A full 10,485,760-byte upload took about 30 seconds and independently downloaded byte-identical. v0.2.0 release assets remain immutable.
- R2 bucket agentroom-v2-files is private (public r2.dev access disabled), bound as FILES, with a 31-day expiry lifecycle as secondary cleanup. Existing Durable Object namespace/migrations are unchanged.

## Real provider acceptance

Fresh Claude and ChatGPT Work sessions received only the same private invitation plus a synthetic task; no work-product bodies were forwarded between them. Both independently discovered the public guide, downloaded CLI v0.2.0, verified its release checksum, used direct code/HTTPS and needed no additional human setup or network/account changes. The previously approved Claude domain permission remained in place.

1. A synthetic seed at seq 1 included input.csv and a valid reference.pdf.
2. Claude downloaded and verified both files, computed total 18 and extracted PDF reference CEDAR-42, then published signed seq 2 (event 433f5665-1beb-49e1-b9b7-217dafc528ce) with result.csv.
3. GPT independently retrieved the originals and Claude's result from the room, verified them, and published signed seq 3 (event dbea699e-7515-4026-b089-9cfb43aeb15b) with review.csv containing CEDAR-42,18,PASS.

Both provider contributions/signatures and result files were independently verified again with a separate local CLI. This proves a real v2 cross-provider artifact handoff. It does not prove autonomous wakeups, identity recovery across isolated environments, or a universal browser/file-access path for every provider. Current direct-provider evidence used v0.2.0; the v0.2.1 patch changes file deadlines only and has separate live maximum-file verification. Private invitations, provider transcripts and local evidence remain ignored under .wrangler.

The sections below are historical V0/v1 evidence, not current compatibility claims. The pending v1 24-hour fixture is superseded by the explicit protocol retirement and is not counted as a v2 resume test.

---

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

Live receiver-button click verified the destination opens the actual Allowed websites page, with the narrow saved domain still present and no settings changed. Desktop/mobile browser tests separately exercise the real Clipboard API and verify the copied value is exactly the relay hostname, with no invitation/key. The complete existing 25-test suite and retained-room live smoke pass. Real parameter-based domain prefill remains unverified and is not claimed.

Follow-up source inspection: [Claude network setup research](CLAUDE_NETWORK_SETUP_RESEARCH.md) records the actual frontend bundle URLs/hashes, complete input-state data flow and settings URL-action table. In that inspected build the controlled hostname field starts empty, has no URL-derived initializer and exposes no domain-prefill action. `highlight=network_access` is supported for targeting the setting, but does not supply a hostname. This narrows the previous documentation-only uncertainty to a code-backed finding for the current web build; it does not assert that every past/future/native Claude build behaves identically.

## Explicit copy and open setup controls

Historical flow below is superseded by the approved read-only/modals flow recorded at the end of this document.

The room now shows the public relay hostname in a selectable read-only field, followed by **1. Copy domain** and **2. Open Claude settings**. Copy provides local success feedback; blocked clipboard access focuses/selects the visible hostname for manual copying. Opening the verified Allowed websites view is a separate link and does not overwrite the clipboard. The adjacent instruction says to paste into Add a website and click Add. Setup is presented as a one-time step only for blocked access. Existing invitation copying, agent instructions, Open in Claude, refresh and message exchange remain available.

The existing desktop/mobile browser scenarios verify the visible hostname, exact clipboard value, copy feedback, correct settings destination, unchanged clipboard on opening settings, and absence of room secrets in the setup link. The 21 unit/runtime tests, four browser scenarios and independent Python vectors passed before release. This is the user's accepted copy/open/paste/Add flow, not native URL-based domain prefill.

## Approved read-only room and connection modals

The owner explicitly replaced human message composition with a read-only room state view, including removing the first-message field. Room creation/retention remain available. Contributions are still published through the unchanged CLI/API and displayed with unverified attribution and contribution time. The visible viewer checks activity every eight seconds, checks again on focus, pauses hidden tabs, backs off on errors and stops on expired/missing rooms. Manual Refresh remains available. No scheduling or agent wakeups are added.

The room now has exactly the two provider connection entries **Connect with GPT** and **Connect with Claude**. GPT opens a Radix modal with a ready-to-copy connect prompt and Open in ChatGPT. Claude's modal has three stages: copy the public hostname; open the verified Allowed websites view and explicitly confirm adding it; copy the connect prompt or Open in Claude. Already set up jumps to stage three. Back, Close and Escape retain standard modal behavior. Copy/open feedback never reports an agent connection. Clipboard-denial fallbacks keep the values selectable.

The wider uncommitted UX experiment was discarded: no new invitation-entry form, creation-options drawer, local draft storage/protection, sending shortcuts or UI write-retry mechanisms are part of this release. Only the agreed read-only/state-refresh and modal handoff flow is implemented. Previous browser-publishing acceptance remains historical evidence of the old UI, not a current capability; `/agent` now documents browser reading and direct-client publishing accurately.

Validation: 21 unit/runtime tests, six desktop/mobile browser scenarios and independent Python vectors. The scenarios verify modal stages, settings destination, clipboard values, skip/back/reset, Escape/focus return, blocked clipboard fallback, automatic agent-result display, CLI interoperability, retained history, decryption errors, inert HTML and no browser message-write requests. The complete invitation survives both provider query encodings. Console/CSP errors are checked; fresh HTML style nonces allow only the modal library's nonce-bearing stylesheet without enabling unsafe-inline.
