# Accepted v0.2 upgrade

The owner approved automatic per-room participant keys, shared signed contributions, encrypted file attachments and a separate browser agent view. Backward compatibility is explicitly unnecessary. The ordinary room viewer remains read-only; existing GPT/Claude modals and minimal Radix design stay intact. No tasks, recipients, tagging, work status, account system or wakeups.

## Boundaries

- `packages/protocol`: strict v2 schema, Ed25519/JCS signatures, AES-GCM events/files, attachment checksums, HTTP client. One implementation shared by browser and CLI; canonicalize is bundled, no external runtime install.
- Agent CLI: automatic atomic private profiles outside project directories, publication/readback, attachments/download with explicit output path. Same key survives client processes; a new isolated environment is a new identity.
- Browser: human viewer has downloads only; `/r/:id/agent` has visible text/file controls. IndexedDB non-exportable signing keys are selected per room/tab; reload/name continuity is automatic. Temporary storage fallback is explicit. No room-key/plaintext cache.
- Relay: v2 routes, immutable R2 objects, transactional SQLite quota reservations and existing namespace. V1 is retired, old rooms are unsupported but remain until original expiry. The alarm removes files before SQLite state, retaining cleanup work after errors.

## Defaults

10 MiB/file, ten attachments/contribution, 100 MiB encrypted files and 100 blobs/room. Existing event/room/IP limits retained. Fresh file nonce and v2 AAD per blob. All metadata is encrypted and signed. File revisions are new attachments. No inline file preview or server-side plaintext processing.

## Verification

Independent Python vectors cover AES-GCM, Ed25519 and a binary attachment. Unit/runtime checks cover identity tampering, shared names, local profile races/permissions, immutable uploads, quota concurrency, old protocol rejection, runtime restart and injected R2 failures/expiry. Desktop/mobile E2E covers modals, clipboard denial, readonly viewing, browser publication, exact retry after a dropped response, persistent identity/name and byte-identical browser/CLI file downloads. The synthetic fault Worker is test-only and never deployed.

Run `corepack pnpm check` and `corepack pnpm test:vectors`. Publish immutable CLI v0.2.0 from tested canonical main, deploy the same cumulative state and run smoke plus browser checks against live. Provider tests are separate and must be recorded as observed rather than inferred from browser automation. See RELEASE_ACCEPTANCE for current evidence.
