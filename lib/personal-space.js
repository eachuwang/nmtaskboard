export const DEFAULT_LOCAL_ACTOR_ID = "local-user";
export const DEFAULT_PERSONAL_WORKSPACE_ID = "personal-local";

export function localPersonalContext(displayName = "我") {
  return Object.freeze({
    actor: Object.freeze({ id: DEFAULT_LOCAL_ACTOR_ID, displayName }),
    workspace: Object.freeze({ id: DEFAULT_PERSONAL_WORKSPACE_ID, type: "workspace", name: "默认工作区", role: "owner" })
  });
}
