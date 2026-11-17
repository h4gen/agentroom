import { describe, it, expect } from "vitest";
import {
  agentPrompt,
  claudeWebURL,
  chatgptWebURL,
} from "../apps/web/src/invitations.ts";
import { inviteURL, randomSecret } from "../packages/protocol/src/index.ts";

describe("explicit provider handoff", () => {
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
    expect(prompt).toContain("Read the room before asking");
    const chatgpt = new URL(chatgptWebURL(link));
    expect(chatgpt.origin).toBe("https://chatgpt.com");
    expect(chatgpt.hash).toBe("");
    expect(chatgpt.searchParams.get("q")).toBe(prompt);
  });
  it("does not turn incomplete or arbitrary URLs into a provider invitation", () => {
    for (const value of [
      "https://relay.example/r/AAAAAAAAAAAAAAAAAAAAAA",
      "javascript:alert(1)",
      "https://relay.example/?k=secret",
    ])
      for (const buildURL of [claudeWebURL, chatgptWebURL])
        expect(() => buildURL(value)).toThrow();
  });
});
