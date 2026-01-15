import { Capability } from "./capability";
import { EventHandler } from "./handler";
import { AvailableCommand, ContentBlock, PromptResponse, SessionId } from "./types";

export interface ModelInfo {
    modelId: string;
    name: string;
    description: string;
}

export interface Mode {
    id: string;
    name: string;
    description: string;
}

export interface Provider {
    // Provider 名称
    name: string;
    // Provider 版本
    // version: string;
    // Provider 已经实现的能力集合，用于预处理能否调用对应的能力
    capabilities: Capability;
    handler: EventHandler;
    // 提前预估可以使用的模型列表，具有时效性，用于提前展示
    estimateModels(): ModelInfo[];
    // 提前预估可以使用的模式列表，具有时效性
    estimateModes(): Mode[];
    // 启动一个会话（Session），需要 "session/new" 能力
    newSession(request: NewSessionRequest): Promise<Session>;
    // TODO:
    // 读取一个会话，update 会重播历史更新
    // loadSession(): Promise<Session>;
    // 分叉一个会话，使用不同的 sessionId 复制一个会话
    // forkSession(): Promise<Session>;
    // 恢复一个会话
    resumeSession(sessionId: SessionId, request: NewSessionRequest): Promise<Session>;
    setSessionModel(sessionId: SessionId, modelId: string): Promise<void>;
    setSessionMode(sessionId: SessionId, modeId: string): Promise<void>;
    // 中断会话
    cancelSession(sessionId: SessionId): Promise<void>;
    // 结束会话
    closeSession(sessionId: SessionId): Promise<void>;
}

export interface Session {
    id: SessionId;
    prompt(prompt: ContentBlock[]): Promise<PromptResponse>;
    // 设置会话使用的模型
    setModel(modelId: string): Promise<void>;
    // 设置会话的权限模式
    setMode(modeId: string): Promise<void>;
    // 中断一个会话
    cancel(): Promise<void>;
    // 结束一个会话
    close(): Promise<void>;

    getAvailableModels(): Promise<ModelInfo[]>
    getAvailableModes(): Promise<Mode[]>
    getAvailableSlashCommands(): Promise<AvailableCommand[]>
}

export type NewSessionRequest = {
    /**
     * The working directory for this session. Must be an absolute path.
     */
    cwd: string;
    // TODO: MCP
    // TODO: Plugin
    // TODO: hooks
}

export type NewSessionResponse = {
    models: ModelInfo[];
    modes: Mode[];
    sessionId: SessionId;
}

export type ResumeSessionRequest = {
    sessionId: SessionId;
    cwd: string;
    // TODO: MCP
    // TODO: Plugin
    // TODO: hooks
}

export type ResumeSessionResponse = {
    models: ModelInfo[];
    modes: Mode[];
}

export type CancelSessionRequest = {
    sessionId: SessionId;
}

export type SetModelRequest = {
    sessionId: SessionId;
    modelId: string
}

export type SetModeRequest = {
    sessionId: SessionId;
    modeId: string
}

export type ProviderOptions = {
    model?: string;
    workdir?: string;
    mode?: string;
    systemPrompt?: string | { append: string };
    handler: EventHandler
    // TODO: tools
    // TODO: MCP
    // TODO: plugin
}