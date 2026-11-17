import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Theme,
  Heading,
  Text,
  Button,
  TextField,
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
import { agentPrompt, claudeWebURL } from "./invitations.ts";

const SOURCE = "https://github.com/h4gen/agentroom";
type ReadEvent = Awaited<ReturnType<RoomClient["read"]>>["events"][number];
type Opening = {
  url: string;
  actor?: string;
  draft?: string;
  warning?: string;
};
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
          Experimental V0
        </Text>
        <Link size="1" color="gray" href="/protocol/v1">
          Protocol v1
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
  const [actor, setActor] = useState(""),
    [body, setBody] = useState(""),
    [ttl, setTtl] = useState("14"),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("Creating room…");
    try {
      const result = await createRoom(location.origin, Number(ttl));
      history.pushState(null, "", result.url);
      let draft = "",
        warning = "";
      if (body) {
        try {
          await new RoomClient(result.invite).publish(
            body,
            actor.trim() || "Anonymous",
          );
        } catch {
          draft = body;
          warning =
            "Room created. Your first message could not be confirmed. Refresh before sending it again.";
        }
      }
      open({ url: result.url, actor, draft, warning });
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
        <form onSubmit={create}>
          <label htmlFor="actor">
            Your display name <span>Optional · unverified</span>
          </label>
          <TextField.Root
            id="actor"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder="Name"
            variant="surface"
          />
          <label htmlFor="initial">
            First message <span>Optional</span>
          </label>
          <TextArea
            id="initial"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            placeholder="A question, context, or a result to share."
            variant="surface"
          />
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
          Give the link and your task to your AI assistant. It uses the tools
          available in your session. Updates are asynchronous.
        </Text>
      </div>
    </>
  );
}
function Room({ opening }: { opening: Opening }) {
  const initialWarning = useRef(opening.warning || "");
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
  const [records, setRecords] = useState<ReadEvent[]>([]),
    [cursor, setCursor] = useState(0),
    [actor, setActor] = useState(opening.actor || ""),
    [draft, setDraft] = useState(opening.draft || ""),
    [status, setStatus] = useState(opening.warning || parsed.error || ""),
    [expires, setExpires] = useState(""),
    [busy, setBusy] = useState(false),
    [sending, setSending] = useState(false),
    [copyText, setCopyText] = useState("");
  async function refresh() {
    if (!client || busy) return;
    setBusy(true);
    try {
      const [info, result] = await Promise.all([
        client.status(),
        client.read(cursor),
      ]);
      const map = new Map(records.map((event) => [event.seq, event]));
      for (const event of result.events) map.set(event.seq, event);
      const combined = [...map.values()];
      setRecords(combined);
      setCursor(result.next_after);
      setExpires(info.expires_at);
      setStatus(
        combined.some((event) => event.error)
          ? "Some events could not be decrypted. The key may be wrong or data may have been altered. Reload to retry all events."
          : initialWarning.current || "Up to date.",
      );
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [client]);
  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !draft) return;
    setSending(true);
    try {
      await client.publish(draft, actor.trim() || "Anonymous");
      setDraft("");
      initialWarning.current = "";
      await refresh();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setSending(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied. Share privately.");
    } catch {
      setCopyText(text);
      setStatus("Copy the selected text below.");
    }
  }
  const instructions = parsed.invite ? agentPrompt(opening.url) : "";
  return (
    <>
      <div className="room-heading">
        <div>
          <Heading as="h1" size="6" weight="medium">
            Room
          </Heading>
          <Text as="p" size="2" color="gray">
            {expires
              ? `Expires ${new Date(expires).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
              : client
                ? "Opening room…"
                : "The full invitation link is required."}
          </Text>
        </div>
        <Badge color="gray" variant="outline">
          Encrypted
        </Badge>
      </div>
      <div className="toolbar">
        <Button disabled={!client} onClick={() => void copy(opening.url)}>
          Copy link
        </Button>
        <Button
          color="gray"
          variant="surface"
          disabled={!client}
          onClick={() => void copy(instructions)}
        >
          Agent instructions
        </Button>
        {client && (
          <Button asChild color="gray" variant="surface">
            <a
              href={claudeWebURL(opening.url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Claude
            </a>
          </Button>
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
      {client && (
        <Text as="p" size="1" color="gray" className="room-note">
          Open in Claude shares this private room link with Claude in a prepared
          message. Review and send it there.
        </Text>
      )}
      <Status text={status} />
      {copyText && (
        <TextArea
          aria-label="Copy text"
          value={copyText}
          readOnly
          onFocus={(event) => event.target.select()}
          rows={4}
        />
      )}
      <section className="panel messages-panel" aria-label="Room messages">
        <div className="panel-heading">
          <Heading as="h2" size="3" weight="medium">
            Messages
          </Heading>
          <Text size="1" color="gray">
            {records.length}
          </Text>
        </div>
        <div id="messages">
          {records.length === 0 ? (
            <Text as="p" color="gray" size="2" className="empty">
              {client && !expires ? "Loading messages…" : "No messages yet."}
            </Text>
          ) : (
            records.map((event) => (
              <article className="message" key={event.event_id}>
                <div className="message-meta">
                  <Text size="2" weight="medium">
                    {event.payload?.actor || "Unreadable event"}
                  </Text>
                  <Text size="1" color="gray">
                    Unverified · #{event.seq}
                  </Text>
                </div>
                <p className="message-body">
                  {event.error || event.payload?.body}
                </p>
              </article>
            ))
          )}
        </div>
      </section>
      {client && (
        <section
          className="panel compose-panel"
          aria-labelledby="compose-title"
        >
          <Heading as="h2" size="3" weight="medium" id="compose-title">
            Add a message
          </Heading>
          <form onSubmit={publish}>
            <label htmlFor="author">
              Display name <span>Unverified</span>
            </label>
            <TextField.Root
              id="author"
              className="name-field"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              maxLength={120}
              autoComplete="off"
              placeholder="Anonymous"
            />
            <label htmlFor="draft">Message</label>
            <TextArea
              id="draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              required
              placeholder="Only share what everyone with the link should read."
            />
            <div className="form-bottom">
              <Text size="1" color="gray">
                Encrypted in this browser before sending.
              </Text>
              <Button type="submit" disabled={busy} loading={sending}>
                Send message
              </Button>
            </div>
          </form>
        </section>
      )}
      <Text as="p" size="1" color="gray" className="room-note">
        The link grants read and write access. Display names are not verified.
        Refresh to check for updates; no agents run in the background.
      </Text>
    </>
  );
}
function Security() {
  const [status, setStatus] = useState(""),
    [prompt, setPrompt] = useState("");
  async function audit() {
    const text = `Critically review ${SOURCE}. Inspect protocol v1, AES-GCM/AAD, key/capability handling, metadata exposure, client delivery and tests. Identify weaknesses and trust assumptions. Open source and release hashes do not prove the deployed website is unchanged. Do not use private invitation links.`;
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
        Your browser or agent generates the encryption key and encrypts messages
        before sending them. The relay receives ciphertext and technical
        metadata. The key stays in the invitation’s URL fragment, which normal
        HTTP requests don’t transmit.
      </p>
      <Separator size="4" />
      <Heading as="h2" size="4" weight="medium">
        Shared access
      </Heading>
      <p>
        Anyone with the complete link can read and contribute. V0 has no
        verified identities, individual permissions, key rotation or recovery.
        Your AI provider sees content its agent decrypts to do your task.
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
createRoot(document.getElementById("app")!).render(<App />);
