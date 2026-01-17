import { test, assert } from "vitest";
import { ClaudeUsageProbe, parseClaudeUsageOutput, ProbeError } from "../src/usage";

test("parseClaudeUsageOutput: session + week + extra usage", () => {
  const sample = [
    "\u001b[2J\u001b[HOpus 4.5 · Claude Pro · jane@example.com's ACME",
    "",
    "Current session",
    "█████ 27% used",
    "Resets in 2h 30m",
    "",
    "Current week (all models)",
    "████████ 40% used",
    "Resets in 3d 1h",
  ].join("\n");

  const snapshot = parseClaudeUsageOutput(sample);
  assert.equal(snapshot.providerId, "claude");
  assert.equal(snapshot.accountTier, "claude_pro");
  assert.equal(snapshot.accountEmail, "jane@example.com");
  assert.equal(snapshot.accountOrganization, "ACME");
  assert.equal(snapshot.quotas.length, 2);
  assert.equal(snapshot.quotas[0].quotaType, "session");
  assert.equal(snapshot.quotas[0].percentRemaining, 73);
  assert.equal(snapshot.quotas[1].quotaType, "weekly");
  assert.equal(snapshot.quotas[1].percentRemaining, 60);
});

test("parseClaudeUsageOutput: API Usage Billing triggers subscriptionRequired", () => {
  const sample = "Sonnet 4.5 · API Usage Billing\nTotal cost: $0.10\n";
  let thrown: unknown = null;
  try {
    parseClaudeUsageOutput(sample);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof ProbeError);
  assert.equal((thrown as ProbeError).code, "subscription_required");
});

test("ClaudeUsageProbe.parse is wired", () => {
  const usage = "Opus 4.5 · Claude Max\nCurrent session\n10% left\n";
  assert.equal(ClaudeUsageProbe.parse(usage).accountTier, "claude_max");
});
