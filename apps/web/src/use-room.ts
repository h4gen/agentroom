import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type RoomClient,
} from "../../../packages/protocol/src/client.ts";

export type ReadEvent = Awaited<
  ReturnType<RoomClient["read"]>
>["events"][number];

// Only the visible web viewer refreshes. This never starts or wakes an agent.
export function useRoom(client: RoomClient | undefined) {
  const [records, setRecords] = useState<ReadEvent[]>([]);
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cursor = useRef(0);
  const events = useRef(new Map<number, ReadEvent>());
  const inFlight = useRef(false);
  const requested = useRef(false);
  const active = useRef(true);
  const terminal = useRef(false);
  const loaded = useRef(false);
  const refresh = useCallback(
    async function refreshRoom(quiet = false): Promise<boolean> {
      if (!client || terminal.current) return true;
      if (inFlight.current) {
        if (!quiet) requested.current = true;
        return true;
      }
      inFlight.current = true;
      if (!quiet) setBusy(true);
      try {
        const info = await client.status();
        // Idle rooms need only the small metadata response, not another history read.
        if (info.last_seq > cursor.current || !loaded.current) {
          const result = await client.read(cursor.current);
          if (!active.current) return true;
          for (const event of result.events)
            events.current.set(event.seq, event);
          cursor.current = result.next_after;
          loaded.current = true;
          if (result.events.length) setRecords([...events.current.values()]);
        }
        if (active.current) {
          setExpires(info.expires_at);
          setError("");
        }
        return true;
      } catch (failure) {
        if (active.current) {
          if (
            failure instanceof ApiError &&
            [404, 409, 410].includes(failure.status)
          ) {
            terminal.current = true;
            setError(
              failure.status === 409
                ? "This room uses an older protocol. Create a new room."
                : "This room has expired or is no longer available. Ask for a new invitation.",
            );
          } else setError("Room activity could not be checked. Reconnecting…");
        }
        return false;
      } finally {
        inFlight.current = false;
        if (active.current && !quiet) setBusy(false);
        if (active.current && requested.current) {
          requested.current = false;
          void refreshRoom();
        }
      }
    },
    [client],
  );
  // Keep the timer independent of state updates and manual refreshes.
  useEffect(() => {
    if (!client) return;
    active.current = true;
    let stopped = false,
      checking = false,
      delay = 8_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (quiet = true) => {
      if (stopped || document.hidden || checking || terminal.current) return;
      checking = true;
      const ok = await refresh(quiet);
      checking = false;
      delay = ok ? 8_000 : Math.min(delay * 2, 60_000);
      if (!stopped && !document.hidden && !terminal.current)
        timer = setTimeout(() => void check(), delay);
    };
    const resume = () => {
      clearTimeout(timer);
      if (!document.hidden) void check();
    };
    void check(false);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      active.current = false;
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [client, refresh]);
  return { records, expires, busy, error, refresh };
}
