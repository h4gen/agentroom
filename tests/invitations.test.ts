import { describe, it, expect } from "vitest";
import {
  agentPrompt,
  claudeWebURL,
  claudeConfigURL,
} from "../apps/web/src/invitations.ts";
import { inviteURL, randomSecret } from "../packages/protocol/src/index.ts";

describe("explicit provider handoff", () => {
  it("opens the real connector configuration with public name and URL only", () => {
    const url = new URL(claudeConfigURL("https://relay.example"));
    expect(url.origin + url.pathname).toBe(
      "https://claude.ai/customize/connectors",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      modal: "add-custom-connector",
      connectorName: "AgentRoom",
      connectorUrl: "https://relay.example/mcp",
    });
    for (const unsafe of [
      "https://relay.example/#k=secret",
      "https://relay.example/?k=secret",
      "https://relay.example/r/id",
      "javascript:alert(1)",
    ])
      expect(() => claudeConfigURL(unsafe)).toThrow();
  });
  it("encodes the entire invitation inside the prompt without losing its fragment or capability", () => {
    const invite = {
      origin: "https://relay.example",
      roomId: "AAAAAAAAAAAAAAAAAAAAAA",
      key: randomSecret(),
      access: randomSecret(),
    };
    const link = inviteURL(invite),
      destination = new URL(claudeWebURL(link));
    expect(destination.origin).toBe("https://claude.ai");
    expect(destination.pathname).toBe("/new");
    expect(destination.hash).toBe("");
    expect([...destination.searchParams.keys()]).toEqual(["q"]);
    const prompt = destination.searchParams.get("q");
    expect(prompt).toBe(agentPrompt(link));
    expect(prompt).toContain(link);
    expect(prompt).toContain(invite.key);
    expect(prompt).toContain(invite.access);
    expect(prompt).toContain("https://relay.example/agent");
    expect(prompt).toContain("Ask for the task");
  });
  it("does not turn incomplete or arbitrary URLs into a provider invitation", () => {
    for (const value of [
      "https://relay.example/r/AAAAAAAAAAAAAAAAAAAAAA",
      "javascript:alert(1)",
      "https://relay.example/?k=secret",
    ])
      expect(() => claudeWebURL(value)).toThrow();
  });
});
