export type Capability = {
    session: SessionCapability[];
    auth: AuthCapability[];
    prompt: PromptCapability[];
    utils: UtilityCapability[];
    agent: AgentCapability[];
}

export type AuthCapability = 
| "auth/login"
| "auth/api_key"

export type SessionCapability =
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

export type UtilityCapability = 
| "utils/generate_session_title"
| "utils/token_usage"

export type AgentCapability = 
| "agent/plan"
| "agent/mcp"
| "agent/skill"
| "agent/sub_agent"
| "agent/command"
| "agent/hook"
