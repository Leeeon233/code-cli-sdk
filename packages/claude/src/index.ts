import { Capability, ContentBlock, EventHandler, Mode, ModeId, ModelId, ModelInfo, NewSessionRequest, PromptResponse, Provider, ProviderOptions, Session, SessionId, Pushable, AvailableCommand, ToolCallContent, ToolKind, ToolCallLocation } from "@code-cli-sdk/core"
import { query, Query, Options, PermissionResult, SDKUserMessage, PermissionMode, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";


export const CLAUDE_CAPABILITY = {
  session: [],
  auth: [],
  utils: [],
  prompt: ["prompt/system_prompt"],
  agent: []
} as Capability;

interface ClaudeCodeSessionOptions {
  query: Query;
  sessionId: SessionId;
  handler: EventHandler;
}

export class ClaudeCodeSession implements Session {
  id: SessionId;
  handler: EventHandler;
  cancelled: boolean = false;
  query: Query;
  public permissionMode: PermissionMode = "default";
  constructor(options: ClaudeCodeSessionOptions) {
    this.id = options.sessionId
    this.handler = options.handler
    this.query = options.query
  }

  prompt(prompt: ContentBlock[]): Promise<PromptResponse> {
    throw new Error("Method not implemented.");
  }
  setModel(modelId: ModelId): Promise<void> {
    throw new Error("Method not implemented.");
  }
  setMode(modeId: ModeId): Promise<void> {
    throw new Error("Method not implemented.");
  }
  cancel(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  close(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    const models = await this.query.supportedModels();
    const defaultModel = models[0];
    await this.query.setModel(defaultModel.value);
    const availableModels = models.map((model) => ({
      modelId: model.value as ModelId,
      name: model.displayName,
      description: model.description,
    }));
    return availableModels
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
    throw new Error("Method not implemented.");
  }
  estimateModes(): Mode[] {
    throw new Error("Method not implemented.");
  }
  async newSession(request: NewSessionRequest): Promise<Session> {
    const sessionId = randomUUID() as SessionId;
    const options = this.buildOptions(sessionId);
    const input = new Pushable<SDKUserMessage>();
    const q = query({
      prompt: input,
      options
    })
    const session = new ClaudeCodeSession({
      sessionId,
      query: q,
      handler: this.options.handler
    })
    this.sessions[sessionId] = session;
    return session;
  }
  resumeSession(sessionId: SessionId, request: NewSessionRequest): Promise<Session> {
    throw new Error("Method not implemented.");
  }
  setSessionModel(sessionId: SessionId, modelId: ModelId): Promise<void> {
    throw new Error("Method not implemented.");
  }
  setSessionMode(sessionId: SessionId, modeId: ModeId): Promise<void> {
    throw new Error("Method not implemented.");
  }
  cancelSession(sessionId: SessionId): Promise<void> {
    throw new Error("Method not implemented.");
  }
  closeSession(sessionId: SessionId): Promise<void> {
    throw new Error("Method not implemented.");
  }

  private canUseTool(sessionId: SessionId,) {
    return async (toolName: string, toolInput: Record<string, unknown>, {
      /** Signaled if the operation should be aborted. */
      signal,
      /**
       * Suggestions for updating permissions so that the user will not be
       * prompted again for this tool during this session.
       *
       * Typically if presenting the user an option 'always allow' or similar,
       * then this full set of suggestions should be returned as the
       * `updatedPermissions` in the PermissionResult.
       */
      suggestions,
      /**
       * The file path that triggered the permission request, if applicable.
       * For example, when a Bash command tries to access a path outside allowed directories.
       */
      blockedPath,
      /** Explains why this permission request was triggered. */
      decisionReason,
      /**
       * Unique identifier for this specific tool call within the assistant message.
       * Multiple tool calls in the same assistant message will have different toolUseIDs.
       */
      toolUseID,
      /** If running within the context of a sub-agent, the sub-agent's ID. */
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
            currentModeId: response.optionId as ModeId,
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

  private buildOptions(sessionId: SessionId, resume?: SessionId, fork?: boolean) {
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
      cwd: this.options.workdir,
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

const acpUnqualifiedToolNames = {
  read: "Read",
  edit: "Edit",
  write: "Write",
  bash: "Bash",
  killShell: "KillShell",
  bashOutput: "BashOutput",
};

export const ACP_TOOL_NAME_PREFIX = "mcp__acp__";
export const acpToolNames = {
  read: ACP_TOOL_NAME_PREFIX + acpUnqualifiedToolNames.read,
  edit: ACP_TOOL_NAME_PREFIX + acpUnqualifiedToolNames.edit,
  write: ACP_TOOL_NAME_PREFIX + acpUnqualifiedToolNames.write,
  bash: ACP_TOOL_NAME_PREFIX + acpUnqualifiedToolNames.bash,
  killShell: ACP_TOOL_NAME_PREFIX + acpUnqualifiedToolNames.killShell,
  bashOutput: ACP_TOOL_NAME_PREFIX + acpUnqualifiedToolNames.bashOutput,
};

export const EDIT_TOOL_NAMES = [acpToolNames.edit, acpToolNames.write];

interface ToolInfo {
  title: string;
  kind: ToolKind;
  content: ToolCallContent[];
  locations?: ToolCallLocation[];
}

interface ToolUpdate {
  title?: string;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
}

export function toolInfoFromToolUse(toolUse: any): ToolInfo {
  const name = toolUse.name;
  const input = toolUse.input;

  switch (name) {
    case "Task":
      return {
        title: input?.description ? input.description : "Task",
        kind: "think",
        content:
          input && input.prompt
            ? [
              {
                type: "content",
                content: { type: "text", text: input.prompt },
              },
            ]
            : [],
      };

    case "NotebookRead":
      return {
        title: input?.notebook_path ? `Read Notebook ${input.notebook_path}` : "Read Notebook",
        kind: "read",
        content: [],
        locations: input?.notebook_path ? [{ path: input.notebook_path }] : [],
      };

    case "NotebookEdit":
      return {
        title: input?.notebook_path ? `Edit Notebook ${input.notebook_path}` : "Edit Notebook",
        kind: "edit",
        content:
          input && input.new_source
            ? [
              {
                type: "content",
                content: { type: "text", text: input.new_source },
              },
            ]
            : [],
        locations: input?.notebook_path ? [{ path: input.notebook_path }] : [],
      };

    case "Bash":
    case acpToolNames.bash:
      return {
        title: input?.command ? "`" + input.command.replaceAll("`", "\\`") + "`" : "Terminal",
        kind: "execute",
        content:
          input && input.description
            ? [
              {
                type: "content",
                content: { type: "text", text: input.description },
              },
            ]
            : [],
      };

    case "BashOutput":
    case acpToolNames.bashOutput:
      return {
        title: "Tail Logs",
        kind: "execute",
        content: [],
      };

    case "KillShell":
    case acpToolNames.killShell:
      return {
        title: "Kill Process",
        kind: "execute",
        content: [],
      };

    case acpToolNames.read: {
      let limit = "";
      if (input.limit) {
        limit =
          " (" + ((input.offset ?? 0) + 1) + " - " + ((input.offset ?? 0) + input.limit) + ")";
      } else if (input.offset) {
        limit = " (from line " + (input.offset + 1) + ")";
      }
      return {
        title: "Read " + (input.file_path ?? "File") + limit,
        kind: "read",
        locations: input.file_path
          ? [
            {
              path: input.file_path,
              line: input.offset ?? 0,
            },
          ]
          : [],
        content: [],
      };
    }

    case "Read":
      return {
        title: "Read File",
        kind: "read",
        content: [],
        locations: input.file_path
          ? [
            {
              path: input.file_path,
              line: input.offset ?? 0,
            },
          ]
          : [],
      };

    case "LS":
      return {
        title: `List the ${input?.path ? "`" + input.path + "`" : "current"} directory's contents`,
        kind: "search",
        content: [],
        locations: [],
      };

    case acpToolNames.edit:
    case "Edit": {
      const path = input?.file_path ?? input?.file_path;

      return {
        title: path ? `Edit \`${path}\`` : "Edit",
        kind: "edit",
        content:
          input && path
            ? [
              {
                type: "diff",
                path,
                oldText: input.old_string ?? null,
                newText: input.new_string ?? "",
              },
            ]
            : [],
        locations: path ? [{ path }] : undefined,
      };
    }

    case acpToolNames.write: {
      let content: ToolCallContent[];
      if (input && input.file_path) {
        content = [
          {
            type: "diff",
            path: input.file_path,
            oldText: null,
            newText: input.content,
          },
        ] as ToolCallContent[];
      } else if (input && input.content) {
        content = [
          {
            type: "content",
            content: { type: "text", text: input.content },
          },
        ] as ToolCallContent[];
      }
      return {
        title: input?.file_path ? `Write ${input.file_path}` : "Write",
        kind: "edit",
        content,
        locations: input?.file_path ? [{ path: input.file_path }] : [],
      };
    }

    case "Write":
      return {
        title: input?.file_path ? `Write ${input.file_path}` : "Write",
        kind: "edit",
        content:
          input && input.file_path
            ? [
              {
                type: "diff",
                path: input.file_path,
                oldText: null,
                newText: input.content,
              },
            ]
            : [],
        locations: input?.file_path ? [{ path: input.file_path }] : [],
      };

    case "Glob": {
      let label = "Find";
      if (input.path) {
        label += ` \`${input.path}\``;
      }
      if (input.pattern) {
        label += ` \`${input.pattern}\``;
      }
      return {
        title: label,
        kind: "search",
        content: [],
        locations: input.path ? [{ path: input.path }] : [],
      };
    }

    case "Grep": {
      let label = "grep";

      if (input["-i"]) {
        label += " -i";
      }
      if (input["-n"]) {
        label += " -n";
      }

      if (input["-A"] !== undefined) {
        label += ` -A ${input["-A"]}`;
      }
      if (input["-B"] !== undefined) {
        label += ` -B ${input["-B"]}`;
      }
      if (input["-C"] !== undefined) {
        label += ` -C ${input["-C"]}`;
      }

      if (input.output_mode) {
        switch (input.output_mode) {
          case "FilesWithMatches":
            label += " -l";
            break;
          case "Count":
            label += " -c";
            break;
          case "Content":
          default:
            break;
        }
      }

      if (input.head_limit !== undefined) {
        label += ` | head -${input.head_limit}`;
      }

      if (input.glob) {
        label += ` --include="${input.glob}"`;
      }

      if (input.type) {
        label += ` --type=${input.type}`;
      }

      if (input.multiline) {
        label += " -P";
      }

      if (input.pattern) {
        label += ` "${input.pattern}"`;
      }

      if (input.path) {
        label += ` ${input.path}`;
      }

      return {
        title: label,
        kind: "search",
        content: [],
      };
    }

    case "WebFetch":
      return {
        title: input?.url ? `Fetch ${input.url}` : "Fetch",
        kind: "fetch",
        content:
          input && input.prompt
            ? [
              {
                type: "content",
                content: { type: "text", text: input.prompt },
              },
            ]
            : [],
      };

    case "WebSearch": {
      let label = `"${input.query}"`;

      if (input.allowed_domains && input.allowed_domains.length > 0) {
        label += ` (allowed: ${input.allowed_domains.join(", ")})`;
      }

      if (input.blocked_domains && input.blocked_domains.length > 0) {
        label += ` (blocked: ${input.blocked_domains.join(", ")})`;
      }

      return {
        title: label,
        kind: "fetch",
        content: [],
      };
    }

    case "TodoWrite":
      return {
        title: Array.isArray(input?.todos)
          ? `Update TODOs: ${input.todos.map((todo: any) => todo.content).join(", ")}`
          : "Update TODOs",
        kind: "think",
        content: [],
      };

    case "ExitPlanMode":
      return {
        title: "Ready to code?",
        kind: "switch_mode",
        content:
          input && input.plan
            ? [{ type: "content", content: { type: "text", text: input.plan } }]
            : [],
      };

    case "Other": {
      let output;
      try {
        output = JSON.stringify(input, null, 2);
      } catch {
        output = typeof input === "string" ? input : "{}";
      }
      return {
        title: name || "Unknown Tool",
        kind: "other",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: `\`\`\`json\n${output}\`\`\``,
            },
          },
        ],
      };
    }

    default:
      return {
        title: name || "Unknown Tool",
        kind: "other",
        content: [],
      };
  }
}