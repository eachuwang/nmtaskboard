const tool = (name, kind, capability, args = [], extra = {}) => Object.freeze({
  name, kind, capability, arguments: Object.freeze(args), ...extra
});

export const AGENT_TOOLS = Object.freeze({
  readBoard: tool("readBoard", "read", "none", []),
  readTask: tool("readTask", "read", "none", ["taskId", "query"], { exclusive: ["taskId", "query"] }),
  readHistory: tool("readHistory", "read", "none", ["taskId", "query"], { exclusive: ["taskId", "query"] }),
  readProgress: tool("readProgress", "read", "none", ["taskId", "query"], { exclusive: ["taskId", "query"] }),
  readReport: tool("readReport", "read", "report", ["type", "range", "includeCompleted", "excludedTaskIds", "includeNextWeek"]),
  readTeamProgress: tool("readTeamProgress", "read", "teamManage", []),
  draftTeamReport: tool("draftTeamReport", "read", "teamManage", ["type", "range", "includeCompleted", "excludedTaskIds", "includeNextWeek"]),
  draftTasks: tool("draftTasks", "write", "create", []),
  draftTaskActions: tool("draftTaskActions", "write", "none", []),
  draftAssignments: tool("draftAssignments", "write", "teamManage", [])
});

export function getAgentTool(name) {
  return AGENT_TOOLS[name] || null;
}

export const AGENT_PLAN_ACTIONS = Object.freeze(Object.keys(AGENT_TOOLS));
export const AGENT_READ_TOOLS = Object.freeze(Object.values(AGENT_TOOLS).filter((item) => item.kind === "read").map((item) => item.name));
export const AGENT_WRITE_TOOLS = Object.freeze(Object.values(AGENT_TOOLS).filter((item) => item.kind === "write").map((item) => item.name));
