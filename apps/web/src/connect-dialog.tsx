import React, { useEffect, useRef, useState } from "react";
import { Button, Dialog, Text, TextArea, TextField } from "@radix-ui/themes";
import {
  agentPrompt,
  chatgptWebURL,
  claudeWebURL,
  CLAUDE_NETWORK_SETTINGS,
} from "./invitations.ts";

function ConnectPrompt({
  provider,
  invitation,
}: {
  provider: "gpt" | "claude";
  invitation: string;
}) {
  const prompt = agentPrompt(invitation);
  const name = provider === "gpt" ? "ChatGPT" : "Claude";
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
      field.current?.focus();
      field.current?.select();
    }
  }
  return (
    <>
      <Text as="p" size="2">
        Copy the connect prompt into your existing agent chat, or open a new
        chat with it already filled in.
      </Text>
      <label htmlFor={`connect-prompt-${provider}`}>Connect prompt</label>
      <TextArea
        ref={field}
        id={`connect-prompt-${provider}`}
        value={prompt}
        readOnly
        rows={5}
        onFocus={(event) => event.target.select()}
      />
      <div className="dialog-actions">
        <Button onClick={() => void copy()}>
          {copied ? "Prompt copied" : "Copy connect prompt"}
        </Button>
        <Button asChild color="gray" variant="surface">
          <a
            href={
              provider === "gpt"
                ? chatgptWebURL(invitation)
                : claudeWebURL(invitation)
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in {name}
          </a>
        </Button>
      </div>
      <Text as="p" size="1" color="gray" aria-live="polite">
        {copied
          ? "Prompt copied. Paste it into your agent chat. "
          : failed
            ? "Copy the selected prompt manually. "
            : ""}
        Review and send the message there. This does not confirm an agent
        connection.
      </Text>
      <Text as="p" size="1" color="gray">
        Opening {name} shares the complete private room link with {name}.
      </Text>
    </>
  );
}

export function ConnectDialog({
  provider,
  invitation,
}: {
  provider: "gpt" | "claude";
  invitation: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [copyFailed, setCopyFailed] = useState(false);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const domain = useRef<HTMLInputElement>(null);
  const stepTitle = useRef<HTMLHeadingElement>(null);
  const title = provider === "gpt" ? "Connect with GPT" : "Connect with Claude";
  useEffect(() => {
    if (open && provider === "claude") stepTitle.current?.focus();
  }, [step, open, provider]);
  async function copyDomain() {
    try {
      await navigator.clipboard.writeText(location.hostname);
      setCopyFailed(false);
      setStep(2);
    } catch {
      setCopyFailed(true);
      domain.current?.focus();
      domain.current?.select();
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setStep(1);
          setCopyFailed(false);
          setSettingsOpened(false);
        }
      }}
    >
      <Dialog.Trigger>
        <Button color="gray" variant="surface">
          {title}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="560px">
        <div className="dialog-heading">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close>
            <Button color="gray" variant="ghost">
              Close
            </Button>
          </Dialog.Close>
        </div>
        <Dialog.Description size="2" color="gray">
          {provider === "gpt"
            ? "Give your agent access to this room."
            : "Set up access, then give your agent the connect prompt."}
        </Dialog.Description>
        <div className="connect-content">
          {provider === "gpt" ? (
            <ConnectPrompt provider="gpt" invitation={invitation} />
          ) : (
            <>
              <Text as="p" size="1" color="gray" aria-live="polite">
                Step {step} of 3
              </Text>
              <h3 ref={stepTitle} tabIndex={-1} className="step-title">
                {step === 1
                  ? "Copy the domain"
                  : step === 2
                    ? "Allow the website in Claude"
                    : "Connect your agent"}
              </h3>
              {step === 1 && (
                <>
                  <Text as="p" size="2">
                    Claude needs permission to reach this website. Copy its
                    domain to continue.
                  </Text>
                  <label htmlFor="allowed-domain">Website to allow</label>
                  <TextField.Root
                    ref={domain}
                    id="allowed-domain"
                    value={location.hostname}
                    readOnly
                    onFocus={(event) => event.target.select()}
                  />
                  <div className="dialog-actions">
                    <Button onClick={() => void copyDomain()}>
                      Copy domain
                    </Button>
                    <Button
                      color="gray"
                      variant="surface"
                      onClick={() => setStep(3)}
                    >
                      Already set up
                    </Button>
                  </div>
                  {copyFailed && (
                    <>
                      <Text as="p" size="1" color="gray" aria-live="polite">
                        Copy the selected domain manually, then continue.
                      </Text>
                      <Button
                        color="gray"
                        variant="surface"
                        onClick={() => setStep(2)}
                      >
                        I copied the domain
                      </Button>
                    </>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <Text as="p" size="2">
                    Open Allowed websites, paste the domain into “Add a
                    website”, then click “Add”. Keep your other website
                    permissions as they are.
                  </Text>
                  <div className="dialog-actions">
                    <Button asChild>
                      <a
                        href={CLAUDE_NETWORK_SETTINGS}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setSettingsOpened(true)}
                      >
                        Open Claude settings
                      </a>
                    </Button>
                  </div>
                  <Text as="p" size="1" color="gray">
                    Return here after adding the website. AgentRoom cannot check
                    this setting.
                  </Text>
                  <div className="dialog-actions">
                    <Button
                      color="gray"
                      variant="surface"
                      onClick={() => setStep(1)}
                    >
                      Back
                    </Button>
                    <Button
                      disabled={!settingsOpened}
                      onClick={() => setStep(3)}
                    >
                      I added the website
                    </Button>
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  <ConnectPrompt provider="claude" invitation={invitation} />
                  <div className="dialog-actions">
                    <Button
                      color="gray"
                      variant="surface"
                      onClick={() => setStep(2)}
                    >
                      Back
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
