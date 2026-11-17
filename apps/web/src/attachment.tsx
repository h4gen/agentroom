import { useState } from "react";
import { Button, Text } from "@radix-ui/themes";
import type { RoomClient } from "../../../packages/protocol/src/client.ts";
import {
  safeFilename,
  type Attachment,
} from "../../../packages/protocol/src/index.ts";
export function AttachmentDownload({
  attachment,
  client,
}: {
  attachment: Attachment;
  client: RoomClient;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const bytes = await client.download(attachment);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/octet-stream" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = safeFilename(attachment.name);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError(
        "Download could not be verified. Retry when the room is available.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attachment">
      <div>
        <Text as="p" size="2">
          {attachment.name}
        </Text>
        <Text size="1" color="gray">
          {attachment.size.toLocaleString()} bytes
        </Text>
      </div>
      <Button
        size="1"
        variant="surface"
        color="gray"
        loading={busy}
        onClick={() => void download()}
        aria-label={`Download ${attachment.name}`}
      >
        Download
      </Button>
      {error && (
        <Text as="p" size="1" role="status">
          {error}
        </Text>
      )}
    </div>
  );
}
