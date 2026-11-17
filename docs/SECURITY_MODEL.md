# Security model — V0

## Assets and trust

K (32 random bytes) encrypts/decrypts shared results; A (separate 32 random bytes) authorizes relay reads/writes. The full invitation contains both. Participants and their authorized personal AI providers are trusted with the plaintext they process. Neither the relay operator nor Cloudflare storage receives K from conforming clients.

Client source delivery is trusted. An altered browser bundle can exfiltrate keys or plaintext. Public source and hashes hosted alongside a release do not establish independent verification of the deployed website. Independently inspect/download the pinned CLI to reduce dependence on the relay's web delivery. No independent audit has been performed.

## Protection and limits

- AES-256-GCM authenticates ciphertext plus room/event AAD; 96-bit fresh random nonces and 128-bit tags. CSPRNG secrets, no password-derived keys.
- Different rooms/events cannot interchange ciphertext without authentication failure.
- The relay validates envelopes, not plaintext or claimed authorship. It cannot create a valid encrypted message without K, but a link-holder can impersonate any display name.
- The relay sees IP/network metadata, room IDs, A during access, access hashes, event IDs, nonce/ciphertext size, sequence and server times. It can correlate activity even without reading content.
- There is no forward secrecy, per-person revocation, verified identity, key rotation, split read/write roles, authenticated global event ordering or log completeness proof.
- Link loss has no recovery. Link disclosure grants access until expiry. Participants can retain their own copies after expiration.
- Relay code delivery, local browser extensions, clipboard/history, screenshots and an AI provider receiving the link are outside encryption-at-rest protection.

## Implementation controls

No third-party scripts, fonts, analytics or telemetry SDKs. Same-origin CSP and API. HTTPS outside localhost. Private responses use no-store; all responses have no-referrer, nosniff, frame restrictions and restrictive permissions policy. Browser cleartext/key state stays in memory and the existing invitation URL; no extra localStorage/IndexedDB copies. Full links remain visible in address/history and copied agent instructions by design.

No application request/error logging; Wrangler observability is disabled. Sanitized error codes never reflect body, URL or headers. Provider infrastructure may still retain technical metadata under its policies. CLI diagnostics redact raw exceptions; create intentionally outputs a recoverable secret link. Use stdin for invitations where possible. Do not enable full request tracing or publish test traces containing live links. Browser test traces are local/ignored, not uploaded by CI.

Input bodies are streamed with a hard bound. Envelope schema is strict, canonical base64url required, nonce exactly 12 bytes, GCM tag at least 16 bytes. Parameterized SQL stores encrypted envelopes only. Atomic per-room insertion/quota/idempotency, rechecking expiry after async work. Unknown-room reads never initialize schema. Constant-work comparison of fixed-size capability hashes avoids obvious early exits.

Room data is rendered using textContent, never HTML. Scripts, external image URLs and commands inside messages are inert text. This protects the web viewer; it does not guarantee a separate AI agent resists prompt injection. Agent templates explicitly subordinate room messages to the user's authorized task. An actual provider test is required before claiming provider-level prompt-injection resistance.

## Lifecycle and abuse

Default retention 14 days, hard maximum 30. Expired requests fail immediately even if alarm delivery is delayed. Alarm cleanup deletes the live SQL/KV storage and is idempotent. No guarantee of immediate removal from provider backups or independently saved participant copies.

Limits: 64 KiB decoded ciphertext/event, 90 KB request, 2,000 events/room, 30 writes/minute/room. Cloudflare IP rate limits are approximate and local to an edge location. They are not a strict global spending limit or proof against distributed abuse. Hosting owners must review the account's plan and usage controls before a broad launch.

V0 is a test deployment. Abuse reports must use only room ID. An operator can delete a room's ciphertext using the authenticated Cloudflare Durable Object administration tools; no public deletion/admin API or content moderation backend is exposed. Operator deletion procedures must be validated in that account before a broader public pilot. No server-side plaintext scanning is possible under this architecture.

## Evidence

Automated tests inspect actual SQLite rows for canary body/author/K/A leakage, inspect client requests for K, exercise wrong key/AAD/ciphertext, replay and concurrency, run actual expiry alarms and restart the Workers runtime. Browser tests cover HTML injection and missing fragments. Tests establish behavior of this source/release; they do not prove that any arbitrary deployed origin serves unchanged code.
