import { Capability } from "./capability";
import { EventHandler } from "./handler";
import { ModeId, ModelId, SessionId } from "./types";

export interface ModelInfo{
    id: ModelId;
    name: string;
    description: string;
}

export interface Mode{
    id: ModeId;
    name: string;
    description: string;
}


export interface Provider{
    // Provider 名称
    name: string;
    // Provider 版本
    version: string;
    // Provider 已经实现的能力集合，用于预处理能否调用对应的能力
    capabilities: Capability;
    // 提前预估可以使用的模型列表，具有时效性，用于提前展示
    estimateModels(): ModelInfo[];
    // 提前预估可以使用的模式列表，具有时效性
    estimateModes(): Mode[];
    // 设置回调
    setHandler(handler: EventHandler): void;
    // 启动一个会话（Session），需要 "session/new" 能力
    newSession(): Promise<Session>;
    // 读取一个会话，update 会重播历史更新
    loadSession(): Promise<Session>;
    // 分叉一个会话，使用不同的 sessionId 复制一个会话
    forkSession(): Promise<Session>;
    // 恢复一个会话
    resumeSession(): Promise<Session>;
    setSessionModel():Promise<void>;
    setSessionMode(): Promise<void>;
    // 中断会话
    cancelSession(): Promise<void>;
    // 结束会话
    closeSession(): Promise<void>;
}

export interface Session{
    id: SessionId;
    prompt(): Promise<void>;
    // 设置会话使用的模型
    setModel(): Promise<void>;
    // 设置会话的权限模式
    setMode(): Promise<void>;
    // 中断一个会话
    cancel(): Promise<void>;
    // 结束一个会话
    close(): Promise<void>;
}

export type NewSessionRequest={
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
    modelId: ModelId
}

export type SetModeRequest = {
    sessionId: SessionId;
    modeId: ModeId
}