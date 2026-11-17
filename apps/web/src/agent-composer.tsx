import { useEffect, useRef, useState } from "react";
import { Button, Heading, Text, TextArea, TextField } from "@radix-ui/themes";
import { RoomClient } from "../../../packages/protocol/src/client.ts";
import {
  encrypt,
  encryptFile,
  message,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  type Envelope,
} from "../../../packages/protocol/src/index.ts";
import {
  browserIdentity,
  rememberName,
  type BrowserIdentity,
} from "./identity.ts";

type Pending = {
  envelope: Envelope;
  files: Awaited<ReturnType<typeof encryptFile>>[];
};
export function AgentComposer({
  client,
  available,
  onPublished,
}: {
  client: RoomClient;
  available: boolean;
  onPublished: () => Promise<unknown>;
}) {
  const [profile, setProfile] = useState<BrowserIdentity>();
  const [name, setName] = useState(""),
    [body, setBody] = useState(""),
    [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const pending = useRef<Pending | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    browserIdentity(client.invite)
      .then((p) => {
        if (active) {
          setProfile(p);
          setName(p.identity.name);
        }
      })
      .catch(() => {
        if (active)
          setStatus(
            "This browser cannot create a signing identity. Use a supported browser or direct client.",
          );
      });
    return () => {
      active = false;
    };
  }, [client]);
  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || busy || !available) return;
    setBusy(true);
    setStatus("Preparing encrypted contribution…");
    try {
      if (!pending.current) {
        if (
          files.length > MAX_ATTACHMENTS ||
          files.some((f) => f.size > MAX_FILE_BYTES)
        )
          throw new Error("Attach at most ten files, each up to 10 MiB.");
        const encrypted = [];
        for (const file of files)
          encrypted.push(
            await encryptFile(
              client.invite.roomId,
              client.invite.key,
              new Uint8Array(await file.arrayBuffer()),
              file.name,
              file.type || "application/octet-stream",
            ),
          );
        const envelope = await encrypt(
          client.invite.roomId,
          client.invite.key,
          message(
            body,
            name.trim(),
            encrypted.map((f) => f.attachment),
          ),
          profile.identity,
        );
        pending.current = { envelope, files: encrypted };
      }
      setStatus("Uploading encrypted contribution…");
      for (const file of pending.current.files)
        await client.upload(file.attachment.blob_id, file.ciphertext);
      const stored = await client.post(pending.current.envelope);
      const readback = await client.read(stored.seq - 1);
      if (
        !readback.events.some(
          (e) => e.event_id === pending.current!.envelope.event_id && e.payload,
        )
      )
        throw new Error("Stored contribution could not be verified yet.");
      await rememberName(
        client.invite,
        profile,
        name.trim() || profile.identity.name,
      );
      pending.current = undefined;
      setBody("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      setStatus(`Published and verified · #${stored.seq}`);
      await onPublished();
    } catch {
      setStatus(
        pending.current
          ? "Publication not confirmed. Retry uses the same encrypted contribution and cannot create a duplicate."
          : "Contribution could not be prepared. Check text, files and browser capabilities.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel compose-panel" aria-label="Agent contribution">
      <Heading as="h2" size="3">
        Publish a contribution
      </Heading>
      <Text as="p" size="2" color="gray">
        Everything you publish is visible to everyone in this room.
      </Text>
      <form onSubmit={publish}>
        <label htmlFor="agent-name">
          Display name <span>Optional</span>
        </label>
        <TextField.Root
          id="agent-name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          disabled={busy || !!pending.current}
        />
        <label htmlFor="agent-body">Contribution</label>
        <TextArea
          id="agent-body"
          value={body}
          rows={5}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy || !!pending.current}
        />
        <label htmlFor="agent-files">
          Attachments <span>Up to 10 files · 10 MiB each</span>
        </label>
        <input
          ref={fileInput}
          id="agent-files"
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
          disabled={busy || !!pending.current}
        />
        <div className="form-bottom">
          <Text size="1" color="gray">
            {profile
              ? `Identity · ${profile.identity.id.slice(0, 8)}${profile.temporary ? " · temporary in this browser" : ""}`
              : "Preparing identity…"}
          </Text>
          <Button
            type="submit"
            loading={busy}
            disabled={
              !available ||
              !profile ||
              (!pending.current && !body.trim() && !files.length)
            }
          >
            {pending.current ? "Retry publication" : "Publish contribution"}
          </Button>
        </div>
      </form>
      <p className="notice" role="status">
        {status}
      </p>
    </section>
  );
}
