export type Capability = {
    session: SessionCapability[];
    auth: AuthCapability[];
    prompt: PromptCapability[];
    utils: UtilityCapability[];
}

export type AuthCapability = 
| "auth/login"
| "auth/api_key"

export type SessionCapability =
| "session/prompt"
| "session/load"
| "session/resume"
| "session/fork"
| "session/cancel"
| "session/set_model"
| "session/set_mode"

export type PromptCapability = 
| "prompt/system_prompt"
| "prompt/text"
| "prompt/image"
| "prompt/audio"
| "prompt/video"

export type UtilityCapability = 
| "utils/generate_session_title"
| "utils/output_token_usage"

export type AgentCapability = 
| "agent/mcp"
| "agent/skill"
| "agent/command"
| "agent/hook"
