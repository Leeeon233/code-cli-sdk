import { type EventHandler, type RequestPermissionRequest, type RequestPermissionResponse } from "@code-cli-sdk/core";
import { ClaudeCodeProvider } from "../src/index";

const handler: EventHandler = {
  async sessionUpdate(update) {
    console.log("sessionUpdate:", update);
  },
  async planUpdate(update) {
    console.log("planUpdate:", update);
  },
  async requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    console.log("requestPermission:", request);
    const allow =
      request.options.find((o) => o.kind === "allow_always") ??
      request.options.find((o) => o.kind === "allow_once") ??
      request.options[0];
    if (!allow) return { outcome: "cancelled" };
    return { outcome: "selected", optionId: allow.optionId };
  },
  async titleGenerated(update) {
    console.log("titleGenerated:", update);
  },
  async modeUpdate(update) {
    console.log("modeUpdate:", update);
  },
  async availableCommandsUpdate(update) {
    console.log("availableCommandsUpdate:", update);
  },
  async usageUpdate(update) {
    console.log("usageUpdate:", update);
  },
  async error(error) {
    console.error("error:", error);
  },
};

async function main() {
  const provider = new ClaudeCodeProvider({ handler });
  const session = await provider.newSession({ cwd: process.cwd() });

  const models = await session.getAvailableModels();
  console.log("getAvailableModels:", models);

  const modes = await session.getAvailableModes();
  console.log("getAvailableModes:", modes);

  const slashCommands = await session.getAvailableSlashCommands();
  console.log("getAvailableSlashCommands:", slashCommands);

  if (process.env.RUN_PROMPT === "1") {
    const res = await session.prompt([{ type: "text", text: "Hello" }]);
    console.log("prompt:", res);
  } else {
    console.log("prompt: skipped (set RUN_PROMPT=1 to run)");
  }

  await provider.closeSession(session.id);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});