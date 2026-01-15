import { Capability, ContentBlock, EventHandler, Mode, ModelInfo, NewSessionRequest, PromptResponse, Provider, ProviderOptions, Session, SessionId, Pushable, AvailableCommand, Logger, RequestError, SessionNotification, PlanEntry, emitUpdate } from "@code-cli-sdk/core"
import { query, Query, Options, PermissionResult, SDKUserMessage, PermissionMode, PermissionUpdate, SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import { BetaContentBlock, BetaRawContentBlockDelta } from "@anthropic-ai/sdk/resources/beta.mjs";
import { EDIT_TOOL_NAMES, registerHookCallback, toolInfoFromToolUse, toolUpdateFromToolResult } from "./tool";

export const CLAUDE_CAPABILITY = {
  session: ["session/resume", "session/set_model", "session/set_mode", "session/cancel", "session/resume"],
  auth: [],
  utils: ["utils/token_usage"],
  prompt: ["prompt/system_prompt", "prompt/text", "prompt/image"],
  agent: ["agent/plan"]
} as Capability;

const ESTIMATE_MODELS = [
  {
    modelId: 'default',
    name: 'Default (recommended)',
    description: 'Use the default model (currently Sonnet 4.5) · $3/$15 per Mtok'
  },
  {
    modelId: 'opus',
    name: 'Opus',
    description: 'Opus 4.5 · Most capable for complex work · $5/$25 per Mtok'
  },
  {
    modelId: 'haiku',
    name: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok'
  }
]

const ESTIMATE_MODES = [
  {
    id: "default",
    name: "Default",
    description: "Standard behavior, prompts for dangerous operations",
  },
  {
    id: "acceptEdits",
    name: "Accept Edits",
    description: "Auto-accept file edit operations",
  },
  {
    id: "plan",
    name: "Plan Mode",
    description: "Planning mode, no actual tool execution",
  },
  {
    id: "dontAsk",
    name: "Don't Ask",
    description: "Don't prompt for permissions, deny if not pre-approved",
  },
];

interface ClaudeCodeSessionOptions {
  query: Query;
  input: Pushable<SDKUserMessage>
  sessionId: SessionId;
  handler: EventHandler;
}

export class ClaudeCodeSession implements Session {
  id: SessionId;
  handler: EventHandler;
  cancelled: boolean = false;
  query: Query;
  toolUseCache: ToolUseCache;
  logger: Logger = console;
  public permissionMode: PermissionMode = "default";
  constructor(private options: ClaudeCodeSessionOptions) {
    this.id = options.sessionId
    this.handler = options.handler
    this.query = options.query
    this.toolUseCache = {}
  }

  async prompt(prompt: ContentBlock[]): Promise<PromptResponse> {
    const result = await this.promptInternal(prompt);
    // TODO: usage
    // TODO: quota
    return result
  }

  async promptInternal(prompt: ContentBlock[]): Promise<PromptResponse> {
    const input = this.options.input;
    const query = this.query;
    input.push(promptToClaude(prompt, this.id));
    while (true) {
      const { value: message, done } = await query.next();
      if (done || !message) {
        if (this.cancelled) {
          return { sessionId: this.id, stopReason: "cancelled" };
        }
        break;
      }

      switch (message.type) {
        case "system":
          switch (message.subtype) {
            case "init":
              break;
            case "compact_boundary":
            case "hook_response":
            case "status":
              // Todo: process via status api: https://docs.claude.com/en/docs/claude-code/hooks#hook-output
              break;
            default:
              unreachable(message, this.logger);
              break;
          }
          break;
        case "result": {
          if (this.cancelled) {
            return { sessionId: this.id, stopReason: "cancelled" };
          }

          switch (message.subtype) {
            case "success": {
              if (message.result.includes("Please run /login")) {
                throw RequestError.authRequired(undefined, undefined);
              }
              if (message.is_error) {
                throw RequestError.internalError(undefined, message.result);
              }
              const usage = message.usage;
              await this.handler.usageUpdate({
                sessionId: this.id,
                modelUsage: message.modelUsage,
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cacheReadInputTokens: usage.cache_read_input_tokens,
                cacheCreationInputTokens: usage.cache_creation_input_tokens,
                total_cost_usd: message.total_cost_usd
              })
              return { sessionId: this.id, stopReason: "end_turn" };
            }
            case "error_during_execution":
              if (message.is_error) {
                throw RequestError.internalError(
                  undefined,
                  message.errors.join(", ") || message.subtype,
                );
              }
              return { sessionId: this.id, stopReason: "end_turn" };
            case "error_max_budget_usd":
            case "error_max_turns":
            case "error_max_structured_output_retries":
              if (message.is_error) {
                throw RequestError.internalError(
                  undefined,
                  message.errors.join(", ") || message.subtype,
                );
              }
              return { sessionId: this.id, stopReason: "max_turn_requests" };
            default:
              unreachable(message, this.logger);
              break;
          }
          break;
        }
        case "stream_event": {
          for (const notification of streamEventToAcpNotifications(
            message,
            this.id,
            this.toolUseCache,
            this.handler,
            this.logger
          )) {
            await emitUpdate(this.handler, notification)
          }
          break;
        }
        case "user":
        case "assistant": {
          if (this.cancelled) {
            break;
          }
          // Slash commands like /compact can generate invalid output... doesn't match
          // their own docs: https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-slash-commands#%2Fcompact-compact-conversation-history
          if (
            typeof message.message.content === "string" &&
            message.message.content.includes("<local-command-stdout>")
          ) {
            this.logger.log(message.message.content);
            break;
          }

          if (
            typeof message.message.content === "string" &&
            message.message.content.includes("<local-command-stderr>")
          ) {
            this.logger.error(message.message.content);
            break;
          }
          // Skip these user messages for now, since they seem to just be messages we don't want in the feed
          if (
            message.type === "user" &&
            (typeof message.message.content === "string" ||
              (Array.isArray(message.message.content) &&
                message.message.content.length === 1 &&
                message.message.content[0].type === "text"))
          ) {
            break;
          }

          if (
            message.type === "assistant" &&
            message.message.model === "<synthetic>" &&
            Array.isArray(message.message.content) &&
            message.message.content.length === 1 &&
            message.message.content[0].type === "text" &&
            message.message.content[0].text.includes("Please run /login")
          ) {
            throw RequestError.authRequired(undefined, undefined);
          }

          const content =
            message.type === "assistant"
              ? // Handled by stream events above
              message.message.content.filter((item) => !["text", "thinking"].includes(item.type))
              : message.message.content;

          for (const notification of toAcpNotifications(
            content,
            message.message.role,
            this.id,
            this.toolUseCache,
            this.handler,
            this.logger,
          )) {
            await emitUpdate(this.handler, notification)
          }
          break;
        }
        case "tool_progress":
          break;
        case "auth_status":
          break;
        default:
          unreachable(message);
          break;
      }
    }
    throw new Error("Session did not end in result");
  }

  async setModel(modelId: string): Promise<void> {
    await this.query.setModel(modelId);
  }

  async setMode(modeId: string): Promise<void> {
    this.permissionMode = modeId as PermissionMode;
    await this.query.setPermissionMode(modeId as PermissionMode)
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    await this.query.interrupt()
  }

  async close(): Promise<void> {
    if (this.cancelled) return;
    await this.cancel();
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    const models = await this.query.supportedModels();
    const defaultModel = models[0];
    await this.query.setModel(defaultModel.value);
    const availableModels = models.map((model) => ({
      modelId: model.value,
      name: model.displayName,
      description: model.description,
    }));
    return availableModels
  }

  async getAvailableModes(): Promise<Mode[]> {
    return ESTIMATE_MODES
  }

  async getAvailableSlashCommands(): Promise<AvailableCommand[]> {
    const UNSUPPORTED_COMMANDS = [
      "context",
      "cost",
      "login",
      "logout",
      "output-style:new",
      "release-notes",
      "todos",
    ];
    const commands = await this.query.supportedCommands();

    return commands
      .map((command) => {
        const input = command.argumentHint ? { hint: command.argumentHint } : null;
        let name = command.name;
        if (command.name.endsWith(" (MCP)")) {
          name = `mcp:${name.replace(" (MCP)", "")}`;
        }
        return {
          name,
          description: command.description || "",
          input,
        };
      })
      .filter((command: AvailableCommand) => !UNSUPPORTED_COMMANDS.includes(command.name));
  }
}

export class ClaudeCodeProvider implements Provider {
  name: string = "Claude Code";
  capabilities: Capability = CLAUDE_CAPABILITY;
  handler: EventHandler;
  sessions: { [key: SessionId]: ClaudeCodeSession } = {}

  constructor(public options: ProviderOptions) {
    this.handler = options.handler;
  }

  estimateModels(): ModelInfo[] {
    return ESTIMATE_MODELS
  }

  estimateModes(): Mode[] {
    return ESTIMATE_MODES
  }

  async newSession(request: NewSessionRequest): Promise<Session> {
    return this.createSession(request.cwd)
  }

  async resumeSession(sessionId: SessionId, request: NewSessionRequest): Promise<Session> {
    return this.createSession(request.cwd, sessionId)
  }

  /*
   * throw if the session not exist
   */
  async setSessionModel(sessionId: SessionId, modelId: string): Promise<void> {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(`SessionId(${sessionId}) is not exist`)
    }
    await session.setModel(modelId);
  }

  /*
   * throw if the session not exist
   */
  async setSessionMode(sessionId: SessionId, modeId: string): Promise<void> {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(`SessionId(${sessionId}) is not exist`)
    }
    await session.setMode(modeId);
  }
  /*
   * throw if the session not exist
   */
  async cancelSession(sessionId: SessionId): Promise<void> {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(`SessionId(${sessionId}) is not exist`)
    }
    await session.cancel();
  }

  async closeSession(sessionId: SessionId): Promise<void> {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(`SessionId(${sessionId}) is not exist`)
    }
    await session.close();
    delete this.sessions[sessionId];
  }

  private createSession(cwd?: string, resume?: SessionId, fork?: boolean): ClaudeCodeSession {
    let sessionId: SessionId;
    if (resume) {
      sessionId = resume;
    } else {
      sessionId = randomUUID() as SessionId;
    }
    const options = this.buildOptions(sessionId, cwd, resume, fork);
    const input = new Pushable<SDKUserMessage>();
    const q = query({
      prompt: input,
      options
    })
    const session = new ClaudeCodeSession({
      sessionId,
      query: q,
      input,
      handler: this.options.handler
    })
    this.sessions[sessionId] = session;
    return session;
  }

  private canUseTool(sessionId: SessionId,) {
    return async (toolName: string, toolInput: Record<string, unknown>, {
      signal,
      suggestions,
      blockedPath,
      decisionReason,
      toolUseID,
      agentID
    }: {
      /** Signaled if the operation should be aborted. */
      signal: AbortSignal;
      /**
       * Suggestions for updating permissions so that the user will not be
       * prompted again for this tool during this session.
       *
       * Typically if presenting the user an option 'always allow' or similar,
       * then this full set of suggestions should be returned as the
       * `updatedPermissions` in the PermissionResult.
       */
      suggestions?: PermissionUpdate[];
      /**
       * The file path that triggered the permission request, if applicable.
       * For example, when a Bash command tries to access a path outside allowed directories.
       */
      blockedPath?: string;
      /** Explains why this permission request was triggered. */
      decisionReason?: string;
      /**
       * Unique identifier for this specific tool call within the assistant message.
       * Multiple tool calls in the same assistant message will have different toolUseIDs.
       */
      toolUseID: string;
      /** If running within the context of a sub-agent, the sub-agent's ID. */
      agentID?: string;
    }): Promise<PermissionResult> => {
      void suggestions;
      void blockedPath;
      void decisionReason;
      void agentID;

      const session = this.sessions[sessionId];
      if (!session) {
        return {
          behavior: "deny",
          message: "Session not found",
          interrupt: true,
        };
      }
      if (toolName === "ExitPlanMode") {
        const response = await this.handler.requestPermission({
          options: [
            {
              kind: "allow_always",
              name: "Yes, and auto-accept edits",
              optionId: "acceptEdits",
            },
            { kind: "allow_once", name: "Yes, and manually approve edits", optionId: "default" },
            { kind: "reject_once", name: "No, keep planning", optionId: "plan" },
          ],
          sessionId,
          toolCall: {
            toolCallId: toolUseID,
            rawInput: toolInput,
            title: toolInfoFromToolUse({ name: toolName, input: toolInput }).title,
          },
        });

        if (signal.aborted || response?.outcome === "cancelled") {
          throw new Error("Tool use aborted");
        }
        if (
          response?.outcome === "selected" &&
          (response.optionId === "default" || response.optionId === "acceptEdits")
        ) {
          session.permissionMode = response.optionId;
          await this.handler.modeUpdate({
            sessionId,
            currentModeId: response.optionId
          });

          return {
            behavior: "allow",
            updatedInput: toolInput,
            updatedPermissions: suggestions ?? [
              { type: "setMode", mode: response.optionId, destination: "session" },
            ],
          };
        } else {
          return {
            behavior: "deny",
            message: "User rejected request to exit plan mode.",
            interrupt: true,
          };
        }
      }

      if (
        session.permissionMode === "bypassPermissions" ||
        (session.permissionMode === "acceptEdits" && EDIT_TOOL_NAMES.includes(toolName))
      ) {
        return {
          behavior: "allow",
          updatedInput: toolInput,
          updatedPermissions: suggestions ?? [
            { type: "addRules", rules: [{ toolName }], behavior: "allow", destination: "session" },
          ],
        };
      }

      const response = await this.handler.requestPermission({
        options: [
          {
            kind: "allow_always",
            name: "Always Allow",
            optionId: "allow_always",
          },
          { kind: "allow_once", name: "Allow", optionId: "allow" },
          { kind: "reject_once", name: "Reject", optionId: "reject" },
        ],
        sessionId,
        toolCall: {
          toolCallId: toolUseID,
          rawInput: toolInput,
          title: toolInfoFromToolUse({ name: toolName, input: toolInput }).title,
        },
      });
      if (signal.aborted || response.outcome === "cancelled") {
        throw new Error("Tool use aborted");
      }
      if (
        response.outcome === "selected" &&
        (response.optionId === "allow" || response.optionId === "allow_always")
      ) {
        // If Claude Code has suggestions, it will update their settings already
        if (response.optionId === "allow_always") {
          return {
            behavior: "allow",
            updatedInput: toolInput,
            updatedPermissions: suggestions ?? [
              {
                type: "addRules",
                rules: [{ toolName }],
                behavior: "allow",
                destination: "session",
              },
            ],
          };
        }
        return {
          behavior: "allow",
          updatedInput: toolInput,
        };
      } else {
        return {
          behavior: "deny",
          message: "User refused permission to run tool",
          interrupt: true,
        };
      };
    }
  }

  private buildOptions(sessionId: SessionId, cwd?: string, resume?: SessionId, fork?: boolean) {
    // system prompt
    let systemPrompt: Options["systemPrompt"] = { type: "preset", preset: "claude_code" };
    if (this.options.systemPrompt) {
      const customPrompt = this.options.systemPrompt;
      if (typeof customPrompt === "string") {
        systemPrompt = customPrompt;
      } else {
        systemPrompt.append = customPrompt.append;
      }
    }
    // TODO: mcp
    // extra Args
    // hooks
    // Setting Manager
    // Tools


    const extraArgs = {}
    if (resume === undefined || fork) {
      extraArgs['session-id'] = sessionId
    }


    const options: Options = {
      systemPrompt,
      settingSources: ["user", "project", "local"],
      permissionMode: "default",
      stderr: (err) => this.options.handler.error(new Error(err)),
      cwd,
      includePartialMessages: true,
      canUseTool: this.canUseTool(sessionId),
      resume,
      forkSession: fork,
      extraArgs,
      ...(process.env.CLAUDE_CODE_EXECUTABLE && {
        pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE,
      }),
    }
    return options;
  }
}

export function promptToClaude(prompt: ContentBlock[], sessionId: SessionId): SDKUserMessage {
  const content: any[] = [];
  const context: any[] = [];

  for (const chunk of prompt) {
    switch (chunk.type) {
      case "text": {
        let text = chunk.text;
        // change /mcp:server:command args -> /server:command (MCP) args
        const mcpMatch = text.match(/^\/mcp:([^:\s]+):(\S+)(\s+.*)?$/);
        if (mcpMatch) {
          const [, server, command, args] = mcpMatch;
          text = `/${server}:${command} (MCP)${args || ""}`;
        }
        content.push({ type: "text", text });
        break;
      }
      case "resource_link": {
        const formattedUri = formatUriAsLink(chunk.uri);
        content.push({
          type: "text",
          text: formattedUri,
        });
        break;
      }
      case "resource": {
        if ("text" in chunk.resource) {
          const formattedUri = formatUriAsLink(chunk.resource.uri);
          content.push({
            type: "text",
            text: formattedUri,
          });
          context.push({
            type: "text",
            text: `\n<context ref="${chunk.resource.uri}">\n${chunk.resource.text}\n</context>`,
          });
        }
        // Ignore blob resources (unsupported)
        break;
      }
      case "image":
        if (chunk.data) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              data: chunk.data,
              media_type: chunk.mimeType,
            },
          });
        } else if (chunk.uri && chunk.uri.startsWith("http")) {
          content.push({
            type: "image",
            source: {
              type: "url",
              url: chunk.uri,
            },
          });
        }
        break;
      // Ignore audio and other unsupported types
      default:
        break;
    }
  }

  content.push(...context);

  return {
    type: "user",
    message: {
      role: "user",
      content: content,
    },
    session_id: sessionId,
    parent_tool_use_id: null,
  };
}
function formatUriAsLink(uri: string): string {
  try {
    if (uri.startsWith("file://")) {
      const path = uri.slice(7); // Remove "file://"
      const name = path.split("/").pop() || path;
      return `[@${name}](${uri})`;
    }
    return uri;
  } catch {
    return uri;
  }
}

export function unreachable(value: never, logger: Logger = console) {
  let valueAsString: string;
  try {
    valueAsString = JSON.stringify(value);
  } catch {
    valueAsString = value;
  }
  logger.error(`Unexpected case: ${valueAsString}`);
}

/**
 * Convert an SDKAssistantMessage (Claude) to a SessionNotification (ACP).
 * Only handles text, image, and thinking chunks for now.
 */
export function toAcpNotifications(
  content: string | ContentBlockParam[] | BetaContentBlock[] | BetaRawContentBlockDelta[],
  role: "assistant" | "user",
  sessionId: SessionId,
  toolUseCache: ToolUseCache,
  handler: EventHandler,
  logger: Logger,
): SessionNotification[] {
  if (typeof content === "string") {
    return [
      {
        sessionId,
        update: {
          sessionUpdate: role === "assistant" ? "agent_message_chunk" : "user_message_chunk",
          type: "text",
          text: content,
        },
      },
    ];
  }

  const output: SessionNotification[] = [];
  // Only handle the first chunk for streaming; extend as needed for batching
  for (const chunk of content) {
    let update: SessionNotification["update"] | null = null;
    switch (chunk.type) {
      case "text":
      case "text_delta":
        update = {
          sessionUpdate: role === "assistant" ? "agent_message_chunk" : "user_message_chunk",
          type: "text",
          text: chunk.text,
        };
        break;
      case "image":
        update = {
          sessionUpdate: role === "assistant" ? "agent_message_chunk" : "user_message_chunk",
          type: "image",
          data: chunk.source.type === "base64" ? chunk.source.data : undefined,
          mimeType: chunk.source.type === "base64" ? chunk.source.media_type : "",
          uri: chunk.source.type === "url" ? chunk.source.url : undefined,
        };
        break;
      case "thinking":
      case "thinking_delta":
        update = {
          sessionUpdate: "agent_thought_chunk",
          type: "text",
          text: chunk.thinking,
        };
        break;
      case "tool_use":
      case "server_tool_use":
      case "mcp_tool_use": {
        toolUseCache[chunk.id] = chunk;
        if (chunk.name === "TodoWrite") {
          // @ts-expect-error - sometimes input is empty object
          if (Array.isArray(chunk.input.todos)) {
            update = {
              sessionUpdate: "plan",
              entries: planEntries(chunk.input as { todos: ClaudePlanEntry[] }),
            };
          }
        } else {
          // Register hook callback to receive the structured output from the hook
          registerHookCallback(chunk.id, {
            onPostToolUseHook: async (toolUseId, _toolInput, _toolResponse) => {
              const toolUse = toolUseCache[toolUseId];
              if (toolUse) {
                const update: SessionNotification["update"] = {
                  toolCallId: toolUseId,
                  sessionUpdate: "tool_call_update",
                };
                await handler.sessionUpdate({
                  sessionId,
                  update,
                });
              } else {
                logger.error(
                  `[claude-code-acp] Got a tool response for tool use that wasn't tracked: ${toolUseId}`,
                );
              }
            },
          });

          let rawInput;
          try {
            rawInput = JSON.parse(JSON.stringify(chunk.input));
          } catch {
            // ignore if we can't turn it to JSON
          }
          update = {
            toolCallId: chunk.id,
            sessionUpdate: "tool_call",
            rawInput,
            status: "pending",
            ...toolInfoFromToolUse(chunk),
          };
        }
        break;
      }

      case "tool_result":
      case "tool_search_tool_result":
      case "web_fetch_tool_result":
      case "web_search_tool_result":
      case "code_execution_tool_result":
      case "bash_code_execution_tool_result":
      case "text_editor_code_execution_tool_result":
      case "mcp_tool_result": {
        const toolUse = toolUseCache[chunk.tool_use_id];
        if (!toolUse) {
          logger.error(
            `[claude-code-acp] Got a tool result for tool use that wasn't tracked: ${chunk.tool_use_id}`,
          );
          break;
        }

        if (toolUse.name !== "TodoWrite") {
          update = {
            toolCallId: chunk.tool_use_id,
            sessionUpdate: "tool_call_update",
            status: "is_error" in chunk && chunk.is_error ? "failed" : "completed",
            ...toolUpdateFromToolResult(chunk, toolUseCache[chunk.tool_use_id]),
          };
        }
        break;
      }

      case "document":
      case "search_result":
      case "redacted_thinking":
      case "input_json_delta":
      case "citations_delta":
      case "signature_delta":
      case "container_upload":
        break;

      default:
        unreachable(chunk, logger);
        break;
    }
    if (update) {
      output.push({ sessionId, update });
    }
  }

  return output;
}

export function streamEventToAcpNotifications(
  message: SDKPartialAssistantMessage,
  sessionId: SessionId,
  toolUseCache: ToolUseCache,
  handler: EventHandler,
  logger: Logger,
): SessionNotification[] {
  const event = message.event;
  switch (event.type) {
    case "content_block_start":
      return toAcpNotifications(
        [event.content_block],
        "assistant",
        sessionId,
        toolUseCache,
        handler,
        logger,
      );
    case "content_block_delta":
      return toAcpNotifications(
        [event.delta],
        "assistant",
        sessionId,
        toolUseCache,
        handler,
        logger,
      );
    // No content
    case "message_start":
    case "message_delta":
    case "message_stop":
    case "content_block_stop":
      return [];

    default:
      unreachable(event, logger);
      return [];
  }
}

export type ClaudePlanEntry = {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
};

export function planEntries(input: { todos: ClaudePlanEntry[] }): PlanEntry[] {
  return input.todos.map((input) => ({
    content: input.content,
    status: input.status,
    priority: "medium",
  }));
}

/**
 * Extra metadata that the agent provides for each tool_call / tool_update update.
 */
export type ToolUpdateMeta = {
  claudeCode?: {
    /* The name of the tool that was used in Claude Code. */
    toolName: string;
    /* The structured output provided by Claude Code. */
    toolResponse?: unknown;
  };
};

type ToolUseCache = {
  [key: string]: {
    type: "tool_use" | "server_tool_use" | "mcp_tool_use";
    id: string;
    name: string;
    input: any;
  };
};
