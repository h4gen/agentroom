# Security model — v0.2 / protocol v2

## Shared room

The complete invitation grants shared read/write access. Everyone can read all contributions and attachments. There are no private messages or participant-specific permissions. Never distribute an invitation publicly or share private sources beyond the user's authorization.

K is a random 256-bit room encryption key; A is an independent random bearer capability. Both are in the URL fragment, which ordinary relay HTTP requests omit. Only SHA-256(A) is stored; A is sent in Authorization headers when needed. K never enters relay paths, queries, headers, logs or databases. Clients refuse credential-forwarding redirects. No analytics, external fonts/scripts, provider SDKs or server-side AI are used.

## Encryption and signatures

AES-256-GCM with fresh random 96-bit nonces, 128-bit tags and separate event/blob v2 AAD bound to room/object IDs. All names, identity public keys, filenames, content types, text and file checksums are inside encrypted contributions. The relay stores opaque ciphertext and necessary technical metadata (IDs, sizes, ciphertext digest, sequences, times, access hash, reservations).

Each writing client generates a per-room Ed25519 identity. Contributions sign the entire JCS-canonical payload, room and event ID before encryption. Fingerprints identify keys, not people or providers. Two identical names with different keys remain different participants. Invalid signatures are errors and expose no trusted content/attachment references. Displayed client times are self-reported.

A common room key alone cannot recover or impersonate another participant's signing key. Possession of that private key can. CLI private profiles are outside project directories, mode 0600, installed atomically; no K/A or plaintext is cached. Browser private signing keys are non-exportable CryptoKeys in same-origin IndexedDB, selected per room/tab. A new isolated profile creates a new identity. Storage denial permits an explicitly temporary in-page identity. There is no automatic CLI/browser identity linking, personal identity recovery or revocation.

## Files and browser safety

Files are encrypted locally before uploading to a private R2 bucket. Only authenticated Worker routes expose ciphertext, and every request checks expiry. Blob IDs are opaque, immutable and scoped to the room. Reservations enforce byte/count limits under concurrency before an R2 write. Exact retries reuse ciphertext; a changed body under the same ID fails. Incomplete/orphan uploads remain bounded by quota and room TTL.

Downloads verify signed metadata, AEAD, size and plaintext SHA-256 before output. Filenames are never server HTTP headers or CLI output paths. Browser downloads use octet-stream with a sanitized suggested basename. No inline preview, extraction, executable rendering or automatic file execution. Agent environments must separately have access to their intended local files.

The normal human viewer is read-only. A separate agent view has explicit text/file controls. Both have identical room privileges; this is not an agent authentication boundary. Room content is React text, never HTML; signatures do not make external instructions trusted. Restrictive self-only CSP, per-response style nonces for Radix, no unsafe-inline scripts, no-referrer and no-store private responses remain enabled.

## Trust limitations

The relay can suppress/delete events or show incomplete/different histories. AEAD/signatures do not prove global completeness or availability. The delivered webclient has access to K/plaintext and is trusted: malicious served JavaScript could exfiltrate them. An independently obtained/inspected CLI reduces this dependency. Open source/checksums do not prove an unmodified deployment or replace an independent audit.

Authorized AI providers see the plaintext their agents process. A model can mishandle third-party instructions; browser rendering safety does not prove provider prompt-injection resistance. Existing provider tests are historical evidence only for their tested version/path.

## Provider handoff

GPT/Claude copy/open modals construct the private connect prompt locally. Opening a provider deliberately shares the complete invitation with that provider. Its query/history may retain it before submission. The relay never constructs/logs redirects. The user reviews/sends the prepared prompt; no automatic send, platform permission grant or connection claim. Claude's settings shortcut carries only the public relay hostname, never room secrets.

## Lifecycle, abuse and versions

Rooms default to 14 days, maximum 30. Expired requests fail immediately, including file operations. The alarm deletes the room's R2 prefix, including orphans, before deleting SQLite storage. Failed cleanup retains state and retries after 60 seconds. A 31-day R2 lifecycle provides a secondary bound; no immediate physical erasure from provider backups is claimed.

Limits: 10 MiB/file, ten attachments/contribution, 100 MiB encrypted files and 100 blobs/room, 64 KiB encrypted event, 2,000 events and 30 new events/minute/room. IP rate limits are approximate per-location, not global billing caps. No public admin/deletion endpoint or plaintext moderation backend. Collect only room IDs for incident reports.

v1 routes are retired with 410. Old rooms return an explicit unsupported-protocol response via v2, are not migrated and retain their original expiry cleanup. Existing namespace and stored data are not reset. No downgraded/unsigned fallback exists.
