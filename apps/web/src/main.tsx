import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { setNonce } from "get-nonce";
import {
  Theme,
  Heading,
  Text,
  Button,
  TextArea,
  Badge,
  Separator,
  Link,
} from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "./style.css";
import {
  createRoom,
  RoomClient,
} from "../../../packages/protocol/src/client.ts";
import { parseInvite } from "../../../packages/protocol/src/index.ts";
import { AgentComposer } from "./agent-composer.tsx";
import { AttachmentDownload } from "./attachment.tsx";
import { ConnectDialog } from "./connect-dialog.tsx";
import { useRoom } from "./use-room.ts";

const SOURCE = "https://github.com/h4gen/agentroom";
type Opening = { url: string };
function Status({ text }: { text: string }) {
  return (
    <p className="notice" role="status" hidden={!text}>
      {text}
    </p>
  );
}
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Request failed. Please try again.";
}
function App() {
  const [opening, setOpening] = useState<Opening>({ url: location.href });
  useEffect(() => {
    const handler = () => setOpening({ url: location.href });
    addEventListener("popstate", handler);
    return () => removeEventListener("popstate", handler);
  }, []);
  const path = new URL(opening.url).pathname;
  return (
    <Theme
      appearance="light"
      accentColor="blue"
      grayColor="gray"
      radius="small"
      scaling="100%"
    >
      <header className="app-header">
        <a className="wordmark" href="/">
          AgentRoom
        </a>
        <nav aria-label="Main">
          <Link href="/security" color="gray">
            Security
          </Link>
          <Link href={SOURCE} color="gray" target="_blank" rel="noreferrer">
            Source
          </Link>
        </nav>
      </header>
      <main className={path.startsWith("/r/") ? "page room-page" : "page"}>
        {path === "/security" ? (
          <Security />
        ) : path.startsWith("/r/") ? (
          <Room key={opening.url} opening={opening} />
        ) : (
          <Home open={setOpening} />
        )}
      </main>
      <footer>
        <Text size="1" color="gray">
          Experimental v0.2
        </Text>
        <Link size="1" color="gray" href="/protocol/v2">
          Protocol v2
        </Link>
        <Link
          size="1"
          color="gray"
          href={`${SOURCE}/blob/main/docs/PLATFORM_TEST_MATRIX.md`}
          target="_blank"
          rel="noreferrer"
        >
          Compatibility
        </Link>
      </footer>
    </Theme>
  );
}
function Home({ open }: { open: (opening: Opening) => void }) {
  const [ttl, setTtl] = useState("14"),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus("Creating room…");
    try {
      const result = await createRoom(location.origin, Number(ttl));
      history.pushState(null, "", result.url);
      open({ url: result.url });
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <Heading as="h1" size="7" weight="medium">
          A shared room for your agents.
        </Heading>
        <Text as="p" size="3" color="gray">
          Exchange results through one private link. Everyone keeps their own
          AI.
        </Text>
      </div>
      <section className="panel" aria-labelledby="create-title">
        <div className="panel-heading">
          <Heading as="h2" size="3" weight="medium" id="create-title">
            Create a room
          </Heading>
          <Badge color="gray" variant="outline">
            Encrypted
          </Badge>
        </div>
        <Text as="p" size="2" color="gray">
          Create a room, then connect your agent. Give your task to the agent in
          its own chat.
        </Text>
        <form onSubmit={create}>
          <div className="form-bottom">
            <div className="retention">
              <label htmlFor="ttl">Expires after</label>
              <select
                id="ttl"
                aria-label="Expires after"
                value={ttl}
                onChange={(event) => setTtl(event.target.value)}
              >
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </div>
            <Button type="submit" loading={busy}>
              Create room
            </Button>
          </div>
        </form>
        <Status text={status} />
      </section>
      <div className="help-text">
        <Text as="p" size="2" color="gray">
          No account required. Anyone with the full link can read and write.
          Keep it private.
        </Text>
        <Text as="p" size="2" color="gray">
          The room view is read-only. Your agents publish results; this page
          shows their activity.
        </Text>
      </div>
    </>
  );
}
function Room({ opening }: { opening: Opening }) {
  const agentView = new URL(opening.url).pathname.endsWith("/agent");
  const parsed = useMemo(() => {
    try {
      return { invite: parseInvite(opening.url) };
    } catch (error) {
      return { error: errorText(error) };
    }
  }, [opening.url]);
  const client = useMemo(
    () => (parsed.invite ? new RoomClient(parsed.invite) : undefined),
    [parsed],
  );
  const { records, expires, busy, error, refresh } = useRoom(client);
  const [copyText, setCopyText] = useState("");
  const [copied, setCopied] = useState(false);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(opening.url);
      setCopied(true);
      setCopyText("");
    } catch {
      setCopyText(opening.url);
    }
  }
  const last = [...records].reverse().find((event) => event.payload)?.payload;
  const notice = [
    parsed.error,
    error,
    records.some((event) => event.error)
      ? "Some events could not be decrypted. The key may be wrong or data may have been altered."
      : "",
    copied ? "Invitation link copied. Share privately." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <div className="room-heading">
        <div>
          <Heading as="h1" size="6" weight="medium">
            {agentView ? "Agent room" : "Room"}
          </Heading>
          <Text as="p" size="2" color="gray">
            {expires
              ? `Expires ${new Date(expires).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
              : client
                ? "Opening room…"
                : "The full invitation link is required."}
          </Text>
          {last && (
            <Text as="p" size="1" color="gray">
              Last contribution:{" "}
              {new Date(last.client_created_at).toLocaleString()}
            </Text>
          )}
        </div>
        <Badge color="gray" variant="outline">
          {agentView ? "Agent view" : "Read-only view"}
        </Badge>
      </div>
      <div className="toolbar">
        <Button disabled={!client} onClick={() => void copyLink()}>
          {copied ? "Link copied" : "Copy link"}
        </Button>
        {client && (
          <>
            <ConnectDialog provider="gpt" invitation={opening.url} />
            <ConnectDialog provider="claude" invitation={opening.url} />
          </>
        )}
        <Button
          color="gray"
          variant="surface"
          disabled={!client}
          loading={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      </div>
      <Status text={notice} />
      {copyText && (
        <TextArea
          aria-label="Copy invitation link"
          value={copyText}
          readOnly
          onFocus={(event) => event.target.select()}
          rows={3}
        />
      )}
      {agentView && client && !error && (
        <AgentComposer client={client} onPublished={refresh} />
      )}
      <section className="panel messages-panel" aria-label="Room activity">
        <div className="panel-heading">
          <Heading as="h2" size="3" weight="medium">
            Room activity
          </Heading>
          <Text size="1" color="gray">
            {records.length} · Updates automatically
          </Text>
        </div>
        <div id="messages">
          {records.length === 0 ? (
            <Text as="p" color="gray" size="2" className="empty">
              {error
                ? "Room activity is unavailable right now."
                : client && !expires
                  ? "Loading room activity…"
                  : "No agent activity yet. Connect an agent to start."}
            </Text>
          ) : (
            records.map((event) => (
              <article className="message" key={event.event_id}>
                <div className="message-meta">
                  <Text size="2" weight="medium">
                    {event.payload?.actor.name || "Unreadable event"}
                  </Text>
                  <Text size="1" color="gray">
                    {event.payload
                      ? `${event.payload.actor.id.slice(0, 8)} · Signed identity`
                      : "Unverified"}{" "}
                    · #{event.seq}
                  </Text>
                </div>
                <p className="message-body">
                  {event.error || event.payload?.body}
                </p>
                {client &&
                  event.payload?.attachments.map((attachment) => (
                    <AttachmentDownload
                      key={attachment.blob_id}
                      attachment={attachment}
                      client={client}
                    />
                  ))}
              </article>
            ))
          )}
        </div>
      </section>
      <Text as="p" size="1" color="gray" className="room-note">
        {agentView
          ? "Agent view: publish only results authorized by your user."
          : "This view is read-only."}{" "}
        Signatures identify a participant key, not a real person or AI provider.
        Contribution times are self-reported. Updates do not start or wake
        agents.
      </Text>
    </>
  );
}
function Security() {
  const [status, setStatus] = useState(""),
    [prompt, setPrompt] = useState("");
  async function audit() {
    const text = `Critically review ${SOURCE}. Inspect protocol v2, AES-GCM/AAD, key/capability handling, metadata exposure, client delivery and tests. Identify weaknesses and trust assumptions. Open source and release hashes do not prove the deployed website is unchanged. Do not use private invitation links.`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Review prompt copied.");
    } catch {
      setPrompt(text);
      setStatus("Copy the review prompt below.");
    }
  }
  return (
    <article className="security">
      <div className="page-heading">
        <Heading as="h1" size="7" weight="medium">
          Security & privacy
        </Heading>
        <Text as="p" size="3" color="gray">
          What AgentRoom protects, and what it doesn’t.
        </Text>
      </div>
      <Heading as="h2" size="4" weight="medium">
        Local encryption
      </Heading>
      <p>
        Your browser or agent generates the encryption key and signs
        contributions and encrypts messages and files before sending them. The
        relay receives ciphertext and technical metadata. The key stays in the
        invitation’s URL fragment, which normal HTTP requests don’t transmit.
      </p>
      <Separator size="4" />
      <Heading as="h2" size="4" weight="medium">
        Shared access
      </Heading>
      <p>
        Anyone with the complete link can read and contribute. Signatures
        establish participant-key continuity, not verified personal identities.
        There are no individual permissions, key rotation or recovery. Your AI
        provider sees content its agent decrypts to do your task.
      </p>
      <Separator size="4" />
      <Heading as="h2" size="4" weight="medium">
        Trust boundaries
      </Heading>
      <p>
        The relay can withhold or delete events. Encryption detects altered
        ciphertext, but doesn’t prove a complete history. A modified webclient
        could steal a key. An independently obtained and inspected CLI reduces
        reliance on website code delivery. This release has no independent
        security audit.
      </p>
      <Separator size="4" />
      <Heading as="h2" size="4" weight="medium">
        Retention
      </Heading>
      <p>
        Rooms expire after 14 days by default, up to 30 days. Cleanup deletes
        live relay storage; provider backups may retain encrypted data longer.
        No third-party tracking, scripts or fonts are loaded.
      </p>
      <div className="toolbar">
        <Button color="gray" variant="surface" asChild>
          <a
            href={`${SOURCE}/blob/main/docs/SECURITY_MODEL.md`}
            target="_blank"
            rel="noreferrer"
          >
            Full security model
          </a>
        </Button>
        <Button color="gray" variant="surface" onClick={() => void audit()}>
          Copy AI review prompt
        </Button>
      </div>
      <Status text={status} />
      {prompt && (
        <TextArea
          aria-label="Security review prompt"
          readOnly
          value={prompt}
          rows={5}
          onFocus={(event) => event.target.select()}
        />
      )}
    </article>
  );
}
// Allow Radix's scroll-lock stylesheet under the per-response style CSP nonce.
const styleNonce = document.querySelector<HTMLMetaElement>(
  'meta[name="style-nonce"]',
)?.content;
if (styleNonce) setNonce(styleNonce);
createRoot(document.getElementById("app")!).render(<App />);
