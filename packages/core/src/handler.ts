import { AvailableCommandsUpdate, CurrentModeUpdate, Plan, RequestPermissionRequest, RequestPermissionResponse, SessionId, SessionNotification, SessionUpdate, TitleGeneratedUpdate, UsageUpdate } from "./types";

export interface SessionUpdateWithId {
    sessionId: SessionId;
    update: SessionUpdate;
}

export interface PlanUpdate {
    sessionId: SessionId;
    plan: Plan
}

export interface EventHandler {
    sessionUpdate(update: SessionUpdateWithId): Promise<void>;
    planUpdate(update: PlanUpdate): Promise<void>;
    requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse>;
    titleGenerated(update: TitleGeneratedUpdate): Promise<void>;
    modeUpdate(update: CurrentModeUpdate): Promise<void>;
    availableCommandsUpdate(update: AvailableCommandsUpdate): Promise<void>;
    usageUpdate(update: UsageUpdate): Promise<void>;
    error(error: Error): Promise<void>;
    // TODO: 
    // ConfigOptionUpdate
}

export const emitUpdate = async (handler: EventHandler, update: SessionNotification) => {
    switch (update.update.sessionUpdate) {
        case "user_message_chunk":
        case "agent_message_chunk":
        case "agent_thought_chunk":
        case "tool_call":
        case "tool_call_update":
            await handler.sessionUpdate({
                sessionId: update.sessionId,
                update: update.update
            });
            return;
        case "plan":
            await handler.planUpdate({
                sessionId: update.sessionId,
                plan: update.update
            })
            return;
        case "available_commands_update":
            await handler.availableCommandsUpdate(update.update);
            return;
        case "current_mode_update":
            await handler.modeUpdate(update.update);
            return;
        case "title_generated":
            await handler.titleGenerated(update.update)
            return;
    }
}
