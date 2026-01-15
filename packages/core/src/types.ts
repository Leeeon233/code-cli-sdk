export type SessionId = string & { __brand: "sessionId" }
export type ModelId = string & { _brand: "modelId" }
export type ModeId = string & { _brand: "modeId" }
/**
 * The sender or recipient of messages and data in a conversation.
 */
export type Role = "assistant" | "user";

export type ContentBlock =
    | (TextContent & {
        type: "text";
    })
    | (ImageContent & {
        type: "image";
    })
    | (AudioContent & {
        type: "audio";
    }) | (ResourceLink & {
        type: "resource_link";
    }) | (EmbeddedResource & {
        type: "resource";
    });

export type Content = ContentBlock;
export type ContentChunk = ContentBlock;

export type TextContent = {
    text: string;
}

export type ImageContent = {
    mimeType: string;
    // base64
    data?: string;
    uri?: string | null;
}

export type AudioContent = {
    data: string;
    mimeType: string;
};

/**
 * A resource that the server is capable of reading, included in a prompt or tool call result.
 */
export type ResourceLink = {
    /**
     * The _meta property is reserved by ACP to allow clients and agents to attach additional
     * metadata to their interactions. Implementations MUST NOT make assumptions about values at
     * these keys.
     *
     * See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
     */
    _meta?: {
        [key: string]: unknown;
    } | null;
    annotations?: Annotations | null;
    description?: string | null;
    mimeType?: string | null;
    name: string;
    size?: bigint | null;
    title?: string | null;
    uri: string;
};

/**
 * The contents of a resource, embedded into a prompt or tool call result.
 */
export type EmbeddedResource = {
    /**
     * The _meta property is reserved by ACP to allow clients and agents to attach additional
     * metadata to their interactions. Implementations MUST NOT make assumptions about values at
     * these keys.
     *
     * See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
     */
    _meta?: {
        [key: string]: unknown;
    } | null;
    annotations?: Annotations | null;
    resource: EmbeddedResourceResource;
};

/**
 * Resource content that can be embedded in a message.
 */
export type EmbeddedResourceResource = TextResourceContents | BlobResourceContents;

/**
 * Text-based resource contents.
 */
export type TextResourceContents = {
    /**
     * The _meta property is reserved by ACP to allow clients and agents to attach additional
     * metadata to their interactions. Implementations MUST NOT make assumptions about values at
     * these keys.
     *
     * See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
     */
    _meta?: {
        [key: string]: unknown;
    } | null;
    mimeType?: string | null;
    text: string;
    uri: string;
};

/**
 * Binary resource contents.
 */
export type BlobResourceContents = {
    /**
     * The _meta property is reserved by ACP to allow clients and agents to attach additional
     * metadata to their interactions. Implementations MUST NOT make assumptions about values at
     * these keys.
     *
     * See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
     */
    _meta?: {
        [key: string]: unknown;
    } | null;
    blob: string;
    mimeType?: string | null;
    uri: string;
};

/**
 * Optional annotations for the client. The client can use annotations to inform how objects are used or displayed
 */
export type Annotations = {
    /**
     * The _meta property is reserved by ACP to allow clients and agents to attach additional
     * metadata to their interactions. Implementations MUST NOT make assumptions about values at
     * these keys.
     *
     * See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
     */
    _meta?: {
        [key: string]: unknown;
    } | null;
    audience?: Array<Role> | null;
    lastModified?: string | null;
    priority?: number | null;
};

export type SessionNotification = {
    sessionId: SessionId;
    update: SessionUpdate | (Plan & {
        sessionUpdate: "plan";
    }) | (AvailableCommandsUpdate & {
        sessionUpdate: "available_commands_update";
    }) | (CurrentModeUpdate & {
        sessionUpdate: "current_mode_update";
    })
    // | (ConfigOptionUpdate & {
    //     sessionUpdate: "config_option_update";
    // })
    | (TitleGeneratedUpdate & {
        sessionUpdate: "title_generated";
    });
}

export type SessionUpdate = (ContentChunk & {
    sessionUpdate: "user_message_chunk";
}) | (ContentChunk & {
    sessionUpdate: "agent_message_chunk";
}) | (ContentChunk & {
    sessionUpdate: "agent_thought_chunk";
}) | (ToolCall & {
    sessionUpdate: "tool_call";
}) | (ToolCallUpdate & {
    sessionUpdate: "tool_call_update";
});

/**
 * Represents a tool call that the language model has requested.
 *
 * Tool calls are actions that the agent executes on behalf of the language model,
 * such as reading files, executing code, or fetching data from external sources.
 */
export type ToolCall = {
    /**
     * Content produced by the tool call.
     */
    content?: Array<ToolCallContent>;
    /**
     * The category of tool being invoked.
     * Helps clients choose appropriate icons and UI treatment.
     */
    kind?: ToolKind;
    /**
     * File locations affected by this tool call.
     * Enables "follow-along" features in clients.
     */
    locations?: Array<ToolCallLocation>;
    /**
     * Raw input parameters sent to the tool.
     */
    rawInput?: unknown;
    /**
     * Raw output returned by the tool.
     */
    rawOutput?: unknown;
    /**
     * Current execution status of the tool call.
     */
    status?: ToolCallStatus;
    /**
     * Human-readable title describing what the tool is doing.
     */
    title: string;
    /**
     * Unique identifier for this tool call within the session.
     */
    toolCallId: ToolCallId;
};
/**
 * Content produced by a tool call.
 *
 * Tool calls can produce different types of content including
 * standard content blocks (text, images) or file diffs.
 */
export type ToolCallContent =
    | {
        /**
         * Discriminator for tool call content entries.
         *
         * Note: `Content` already uses `type` for block kinds (e.g. "text"),
         * so tool call entries wrap `Content` instead of intersecting with it.
         */
        type: "content";
        /**
         * Standard content block (text/image/audio) produced by the tool call.
         */
        content: Content;
    }
    | (Diff & {
        /**
         * Discriminator for tool call content entries.
         */
        type: "diff";
    })
/**
 * Unique identifier for a tool call within a session.
 */
export type ToolCallId = string;
/**
 * A file location being accessed or modified by a tool.
 *
 * Enables clients to implement "follow-along" features that track
 * which files the agent is working with in real-time.
 */
export type ToolCallLocation = {
    /**
     * Optional line number within the file.
     */
    line?: number | null;
    /**
     * The file path being accessed or modified.
     */
    path: string;
};
/**
 * Execution status of a tool call.
 *
 * Tool calls progress through different statuses during their lifecycle.
 *
 * See protocol docs: [Status](https://agentclientprotocol.com/protocol/tool-calls#status)
 */
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";
/**
 * An update to an existing tool call.
 *
 * Used to report progress and results as tools execute. All fields except
 * the tool call ID are optional - only changed fields need to be included.
 */
export type ToolCallUpdate = {
    /**
     * Replace the content collection.
     */
    content?: Array<ToolCallContent> | null;
    /**
     * Update the tool kind.
     */
    kind?: ToolKind | null;
    /**
     * Replace the locations collection.
     */
    locations?: Array<ToolCallLocation> | null;
    /**
     * Update the raw input.
     */
    rawInput?: unknown;
    /**
     * Update the raw output.
     */
    rawOutput?: unknown;
    /**
     * Update the execution status.
     */
    status?: ToolCallStatus | null;
    /**
     * Update the human-readable title.
     */
    title?: string | null;
    /**
     * The ID of the tool call being updated.
     */
    toolCallId: ToolCallId;
};
/**
 * Categories of tools that can be invoked.
 *
 * Tool kinds help clients choose appropriate icons and optimize how they
 * display tool execution progress.
 *
 * See protocol docs: [Creating](https://agentclientprotocol.com/protocol/tool-calls#creating)
 */
export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";

/**
 * An execution plan for accomplishing complex tasks.
 *
 * Plans consist of multiple entries representing individual tasks or goals.
 * Agents report plans to clients to provide visibility into their execution strategy.
 * Plans can evolve during execution as the agent discovers new requirements or completes tasks.
 */
export type Plan = {
    /**
     * The list of tasks to be accomplished.
     *
     * When updating a plan, the agent must send a complete list of all entries
     * with their current status. The client replaces the entire plan with each update.
     */
    entries: Array<PlanEntry>;
};
/**
 * A single entry in the execution plan.
 *
 * Represents a task or goal that the assistant intends to accomplish
 * as part of fulfilling the user's request.
 * See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)
 */
export type PlanEntry = {
    /**
     * Human-readable description of what this task aims to accomplish.
     */
    content: string;
    /**
     * The relative importance of this task.
     * Used to indicate which tasks are most critical to the overall goal.
     */
    priority: PlanEntryPriority;
    /**
     * Current execution status of this task.
     */
    status: PlanEntryStatus;
};
/**
 * Priority levels for plan entries.
 *
 * Used to indicate the relative importance or urgency of different
 * tasks in the execution plan.
 * See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)
 */
export type PlanEntryPriority = "high" | "medium" | "low";
/**
 * Status of a plan entry in the execution flow.
 *
 * Tracks the lifecycle of each task from planning through completion.
 * See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)
 */
export type PlanEntryStatus = "pending" | "in_progress" | "completed";

/**
 * The current mode of the session has changed
 *
 * See protocol docs: [Session Modes](https://agentclientprotocol.com/protocol/session-modes)
 */
export type CurrentModeUpdate = {
    sessionId: SessionId;
    /**
     * The ID of the current mode
     */
    currentModeId: ModeId;
};
/**
* Available commands are ready or have changed
*/
export type AvailableCommandsUpdate = {
    /**
     * Commands the agent can execute
     */
    availableCommands: Array<AvailableCommand>;
};

/**
 * Information about a command.
 */
export type AvailableCommand = {
    /**
     * Human-readable description of what the command does.
     */
    description: string;
    /**
     * Input for the command if required
     */
    input?: AvailableCommandInput | null;
    /**
     * Command name (e.g., `create_plan`, `research_codebase`).
     */
    name: string;
};

/**
 * All text that was typed after the command name is provided as input.
 */
export type AvailableCommandInput = UnstructuredCommandInput;
/**
 * All text that was typed after the command name is provided as input.
 */
export type UnstructuredCommandInput = {
    /**
     * A hint to display when the input hasn't been provided yet
     */
    hint: string;
};

/**
 * Update to session metadata. All fields are optional to support partial updates.
 *
 * Agents send this notification to update session information like title or custom metadata.
 * This allows clients to display dynamic session names and track session state changes.
 */
export type SessionInfoUpdate = {
    /**
     * Human-readable title for the session. Set to null to clear.
     */
    title?: string | null;
    /**
     * ISO 8601 timestamp of last activity. Set to null to clear.
     */
    updatedAt?: string | null;
};

/**
 * A diff representing file modifications.
 *
 * Shows changes to files in a format suitable for display in the client UI.
 *
 */
export type Diff = {
    /**
     * The new content after modification.
     */
    newText: string;
    /**
     * The original content (None for new files).
     */
    oldText?: string | null;
    /**
     * The file path being modified.
     */
    path: string;
};

/**
 * Request for user permission to execute a tool call.
 *
 * Sent when the agent needs authorization before performing a sensitive operation.
 *
 */
export type RequestPermissionRequest = {
    /**
    * Available permission options for the user to choose from.
    */
    options: Array<PermissionOption>;
    /**
     * The session ID for this request.
     */
    sessionId: SessionId;
    /**
     * Details about the tool call requiring permission.
     */
    toolCall: ToolCallUpdate;
}

/**
 * An option presented to the user when requesting permission.
 */
export type PermissionOption = {
    /**
     * Hint about the nature of this permission option.
     */
    kind: PermissionOptionKind;
    /**
     * Human-readable label to display to the user.
     */
    name: string;
    /**
     * Unique identifier for this permission option.
     */
    optionId: PermissionOptionId;
};
/**
 * Unique identifier for a permission option.
 */
export type PermissionOptionId = string;
/**
 * The type of permission option being presented to the user.
 *
 * Helps clients choose appropriate icons and UI treatment.
 */
export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export type RequestPermissionResponse = {
    outcome: "cancelled";
} | {
    outcome: "selected";
    optionId: PermissionOptionId
};

export type TitleGeneratedUpdate = {
    sessionId: SessionId;
    title: string;
}

export type StopReason =
    | "end_turn"
    | "max_tokens"
    | "max_turn_requests"
    | "refusal"
    | "cancelled";

export type PromptResponse = {
    sessionId: SessionId;
    stopReason: StopReason
    // usage: NonNullableUsage;
    // modelUsage: {
    //     [modelName: string]: ModelUsage;
    // };
}

export type ModelUsage = {
    inputTokens: number,
    outputTokens: number,
    cacheReadInputTokens: number,
    cacheCreationInputTokens: number,
    webSearchRequests: number,
    costUSD: number,
    contextWindow: number,
    maxOutputTokens: number
}

export type UsageUpdate = {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    modelUsage: {
        [modelName: string]: ModelUsage;
    };
}
