import { AvailableCommandsUpdate, CurrentModeUpdate, Plan, RequestPermissionRequest, RequestPermissionResponse, SessionUpdateNotification, TitleGeneratedUpdate, UsageUpdate } from "./types";

export interface EventHandler{
    sessionUpdate(update: SessionUpdateNotification):Promise<void>;
    planUpdate(update: Plan): Promise<void>;
    requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse>;
    titleGenerated(update: TitleGeneratedUpdate): Promise<void>;
    modeUpdate(update: CurrentModeUpdate): Promise<void>;
    availableCommandsUpdate(update: AvailableCommandsUpdate): Promise<void>;
    usageUpdate(update: UsageUpdate): Promise<void>;
    error(error: Error): Promise<void>
    // TODO: 
    // ConfigOptionUpdate
}
