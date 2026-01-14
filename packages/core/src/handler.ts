import { AvailableCommandsUpdate, CurrentModeUpdate, Plan, RequestPermissionRequest, SessionUpdateNotification, TitleGeneratedUpdate } from "./types";

export interface EventHandler{
    sessionUpdate(update: SessionUpdateNotification):Promise<void>;
    planUpdate(update: Plan): Promise<void>;
    requestPermission(request: RequestPermissionRequest): Promise<void>;
    titleGenerated(update: TitleGeneratedUpdate): Promise<void>;
    modeUpdate(update: CurrentModeUpdate): Promise<void>;
    availableCommandsUpdate(update: AvailableCommandsUpdate): Promise<void>;
    // TODO: 
    // ConfigOptionUpdate
}
