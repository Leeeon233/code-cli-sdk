import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type AccountTier = "claude_pro" | "claude_max" | "claude_api" | "unknown";

export type UsageQuotaType =
  | "session"
  | "weekly"
  | { model: string };

export interface UsageQuota {
  providerId: "claude";
  quotaType: UsageQuotaType;
  percentRemaining: number;
  resetsAt?: Date;
  resetText?: string;
}

export interface UsageSnapshot {
  providerId: "claude";
  capturedAt: Date;
  quotas: UsageQuota[];
  accountTier: AccountTier;
  accountEmail?: string;
  accountOrganization?: string;
  loginMethod?: string;
}

export type AutoResponse = { match: string | RegExp; response: string };

export class ProbeError extends Error {
  readonly code:
    | "execution_failed"
    | "parse_failed"
    | "folder_trust_required"
    | "authentication_required"
    | "update_required"
    | "subscription_required";

  constructor(
    code: ProbeError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
  }

  static executionFailed(message: string) {
    return new ProbeError("execution_failed", message);
  }
  static parseFailed(message: string) {
    return new ProbeError("parse_failed", message);
  }
  static folderTrustRequired() {
    return new ProbeError(
      "folder_trust_required",
      "Claude CLI requires folder trust confirmation",
    );
  }
  static authenticationRequired() {
    return new ProbeError(
      "authentication_required",
      "Claude CLI requires authentication",
    );
  }
  static updateRequired() {
    return new ProbeError(
      "update_required",
      "Claude CLI requires an update",
    );
  }
  static subscriptionRequired() {
    return new ProbeError(
      "subscription_required",
      "Account does not support /usage (API Usage Billing)",
    );
  }
}

export interface ClaudeUsageProbeOptions {
  claudeBinary?: string;
  timeoutMs?: number;
  workingDirectory?: string;
  autoResponses?: AutoResponse[];
}

export class ClaudeUsageProbe {
  private readonly claudeBinary: string;
  private readonly timeoutMs: number;
  private readonly workingDirectory: string;
  private readonly autoResponses: AutoResponse[];

  constructor(options: ClaudeUsageProbeOptions = {}) {
    this.claudeBinary = options.claudeBinary ?? "claude";
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.workingDirectory = options.workingDirectory ?? defaultProbeWorkingDirectory();
    this.autoResponses = options.autoResponses ?? defaultAutoResponses();
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(await locateOnPath(this.claudeBinary));
  }

  async probe(): Promise<UsageSnapshot> {
    const usageOutput = await this.runClaude(["/usage", "--allowed-tools", ""]);
    return parseClaudeUsageOutput(usageOutput);
  }

  private async runClaude(args: string[]): Promise<string> {
    const resolvedBinary = (await locateOnPath(this.claudeBinary)) ?? this.claudeBinary;
    try {
      return await executeCommand({
        binary: resolvedBinary,
        args,
        cwd: this.workingDirectory,
        timeoutMs: this.timeoutMs,
        stdin: "",
        autoResponses: this.autoResponses,
      });
    } catch (err: any) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
      throw ProbeError.executionFailed(message);
    }
  }

  static parse(text: string): UsageSnapshot {
    return parseClaudeUsageOutput(text);
  }
}

function defaultProbeWorkingDirectory(): string {
  const base = path.join(os.tmpdir(), "code-cli-sdk", "claude", "probe");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function defaultAutoResponses(): AutoResponse[] {
  return [
    { match: "Esc to cancel", response: "\n" },
    { match: "Ready to code here?", response: "\n" },
    { match: "Press Enter to continue", response: "\n" },
    { match: "ctrl+t to disable", response: "\n" },
    { match: /Do you trust the files in this folder\?/i, response: "\n" },
  ];
}

async function locateOnPath(binary: string): Promise<string | null> {
  if (binary.includes("/") || binary.includes("\\")) {
    try {
      await fs.promises.access(binary, fs.constants.X_OK);
      return binary;
    } catch {
      return null;
    }
  }

  const pathValue = process.env.PATH ?? "";
  const entries = pathValue.split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = path.join(entry, binary);
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

type ExecuteCommandOptions = {
  binary: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin: string;
  autoResponses: AutoResponse[];
};

async function executeCommand(options: ExecuteCommandOptions): Promise<string> {
  const child = spawn(options.binary, options.args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  const responded = new Set<number>();
  let output = "";
  let stderr = "";

  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    for (let i = 0; i < options.autoResponses.length; i++) {
      if (responded.has(i)) continue;
      const rule = options.autoResponses[i];
      if (typeof rule.match === "string") {
        if (!output.includes(rule.match)) continue;
      } else {
        if (!rule.match.test(output)) continue;
      }
      responded.add(i);
      child.stdin.write(rule.response);
    }
  };

  child.stdout.on("data", onChunk);
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    onChunk(chunk);
  });

  if (options.stdin) child.stdin.write(options.stdin);

  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, options.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  }).finally(() => clearTimeout(timeout));

  const combined = output + (stderr && !output.includes(stderr) ? `\n${stderr}` : "");
  if (exitCode !== 0) {
    throw new Error(`Command exited with code ${exitCode}: ${combined}`);
  }
  return combined;
}

function normalizeTerminalText(text: string): string {
  let t = text;

  // Normalize line endings and remove common terminal control sequences.
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = stripAnsi(t);
  t = t.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g, "");

  // Trim right side of each line to reduce padding artifacts.
  t = t
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  // Collapse excessive blank lines.
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function stripAnsi(text: string): string {
  // CSI: ESC [ ... command
  let t = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  // OSC: ESC ] ... BEL or ESC \
  t = t.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
  // DCS/PM/APC: ESC P|^|_ ... ESC \
  t = t.replace(/\u001b[\u0050\u005e\u005f][\s\S]*?\u001b\\/g, "");
  return t;
}

export function parseClaudeUsageOutput(text: string): UsageSnapshot {
  const clean = normalizeTerminalText(text);

  const usageError = extractUsageError(clean);
  if (usageError) throw usageError;

  const accountTier = detectAccountTier(clean);
  if (accountTier === "claude_api") throw ProbeError.subscriptionRequired();

  const sessionPct = extractPercent({ labelSubstring: "Current session", text: clean });
  if (sessionPct == null) throw ProbeError.parseFailed("Could not find session usage");

  const weeklyPct = extractPercent({ labelSubstring: "Current week (all models)", text: clean });
  const opusPct = extractPercent({ labelSubstring: "Current week (Opus)", text: clean });
  const sonnetPct = extractPercent({
    labelSubstrings: ["Current week (Sonnet only)", "Current week (Sonnet)"],
    text: clean,
  });

  const sessionResetText = extractReset({ labelSubstring: "Current session", text: clean });
  const weeklyResetText = extractReset({ labelSubstring: "Current week", text: clean });

  const quotas: UsageQuota[] = [
    {
      providerId: "claude",
      quotaType: "session",
      percentRemaining: sessionPct,
      resetsAt: parseResetDate(sessionResetText),
      resetText: cleanResetText(sessionResetText),
    },
  ];

  if (weeklyPct != null) {
    quotas.push({
      providerId: "claude",
      quotaType: "weekly",
      percentRemaining: weeklyPct,
      resetsAt: parseResetDate(weeklyResetText),
      resetText: cleanResetText(weeklyResetText),
    });
  }

  if (opusPct != null) {
    quotas.push({
      providerId: "claude",
      quotaType: { model: "opus" },
      percentRemaining: opusPct,
      resetsAt: parseResetDate(weeklyResetText),
      resetText: cleanResetText(weeklyResetText),
    });
  }

  if (sonnetPct != null) {
    quotas.push({
      providerId: "claude",
      quotaType: { model: "sonnet" },
      percentRemaining: sonnetPct,
      resetsAt: parseResetDate(weeklyResetText),
      resetText: cleanResetText(weeklyResetText),
    });
  }

  return {
    providerId: "claude",
    quotas,
    capturedAt: new Date(),
    accountEmail: extractEmail(clean),
    accountOrganization: extractOrganization(clean),
    loginMethod: extractLoginMethod(clean),
    accountTier,
  };
}

function detectAccountTier(text: string): AccountTier {
  const lower = text.toLowerCase();
  if (lower.includes("· claude pro") || lower.includes("·claude pro")) return "claude_pro";
  if (lower.includes("· claude max") || lower.includes("·claude max")) return "claude_max";
  if (lower.includes("api usage billing")) return "claude_api";

  const hasSessionQuota =
    lower.includes("current session") &&
    (lower.includes("% left") || lower.includes("% used"));
  if (hasSessionQuota) return "claude_max";
  return "unknown";
}

function extractUsageError(text: string): ProbeError | null {
  const lower = text.toLowerCase();

  if (lower.includes("do you trust the files in this folder?") && !lower.includes("current session")) {
    return ProbeError.folderTrustRequired();
  }

  if (
    lower.includes("token_expired") ||
    lower.includes("token has expired") ||
    lower.includes("authentication_error") ||
    lower.includes("not logged in") ||
    lower.includes("please log in")
  ) {
    return ProbeError.authenticationRequired();
  }

  if (lower.includes("update required") || lower.includes("please update")) {
    return ProbeError.updateRequired();
  }

  const isRateLimitError =
    (lower.includes("rate limited") ||
      lower.includes("rate limit exceeded") ||
      lower.includes("too many requests")) &&
    !lower.includes("rate limits are");
  if (isRateLimitError) return ProbeError.executionFailed("Rate limited - too many requests");

  return null;
}

function extractPercent(options: { labelSubstring: string; text: string }): number | null;
function extractPercent(options: { labelSubstrings: string[]; text: string }): number | null;
function extractPercent(
  options:
    | { labelSubstring: string; text: string }
    | { labelSubstrings: string[]; text: string },
): number | null {
  if ("labelSubstrings" in options) {
    for (const labelSubstring of options.labelSubstrings) {
      const value = extractPercent({ labelSubstring, text: options.text });
      if (value != null) return value;
    }
    return null;
  }

  const lines = options.text.split("\n");
  const label = options.labelSubstring.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].toLowerCase().includes(label)) continue;
    for (const candidate of lines.slice(i, i + 12)) {
      const pct = percentFromLine(candidate);
      if (pct != null) return pct;
    }
  }
  return null;
}

function percentFromLine(line: string): number | null {
  const match = line.match(/([0-9]{1,3})\s*%\s*(used|left)/i);
  if (!match) return null;
  const rawVal = Number.parseInt(match[1] ?? "0", 10);
  const isUsed = (match[2] ?? "").toLowerCase().includes("used");
  const remaining = isUsed ? Math.max(0, 100 - rawVal) : rawVal;
  return Math.min(100, Math.max(0, remaining));
}

function extractReset(options: { labelSubstring: string; text: string }): string | null {
  const lines = options.text.split("\n");
  const label = options.labelSubstring.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].toLowerCase().includes(label)) continue;
    for (const candidate of lines.slice(i, i + 14)) {
      const lower = candidate.toLowerCase();
      if (
        lower.includes("reset") ||
        (lower.includes("in") && (lower.includes("h") || lower.includes("m") || lower.includes("d")))
      ) {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
      }
    }
  }
  return null;
}

function cleanResetText(text: string | null): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase().startsWith("reset")) return trimmed;
  return `Resets ${trimmed}`;
}

function parseResetDate(text: string | null): Date | undefined {
  if (!text) return undefined;
  let totalSeconds = 0;

  const days = matchInt(text, /(\d+)\s*d(?:ays?)?/i);
  if (days != null) totalSeconds += days * 24 * 3600;

  const hours = matchInt(text, /(\d+)\s*h(?:ours?|r)?/i);
  if (hours != null) totalSeconds += hours * 3600;

  const minutes = matchInt(text, /(\d+)\s*m(?:in(?:utes?)?)?/i);
  if (minutes != null) totalSeconds += minutes * 60;

  if (totalSeconds <= 0) return undefined;
  return new Date(Date.now() + totalSeconds * 1000);
}

function matchInt(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const n = Number.parseInt(m[0].replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function extractEmail(text: string): string | undefined {
  const old = extractFirst(text, /(?:Account|Email):\s*([^\s@]+@[^\s@]+)/i);
  if (old) return old;
  const header = extractFirst(text, /·\s*Claude\s+(?:Max|Pro)\s*·\s*([^\s@]+@[^\s@']+)/i);
  return header ?? undefined;
}

function extractOrganization(text: string): string | undefined {
  const old = extractFirst(text, /(?:Org|Organization):\s*([^\n]+)/i);
  if (old) return old.trim();
  const header = extractFirst(text, /·\s*Claude\s+(?:Max|Pro)\s*·\s*([^\n]+)/i);
  const trimmed = header?.trim();
  if (!trimmed) return undefined;
  const possessiveIndex = trimmed.lastIndexOf("'s ");
  if (possessiveIndex >= 0) return trimmed.slice(possessiveIndex + 3).trim() || undefined;
  return trimmed;
}

function extractLoginMethod(text: string): string | undefined {
  const login = extractFirst(text, /login\s+method:\s*([^\n]+)/i);
  return login?.trim() ?? undefined;
}

function extractFirst(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m || m.length < 2) return null;
  return (m[1] ?? "").trim() || null;
}
