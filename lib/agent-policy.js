import { AGENT_WRITE_TOOLS, getAgentTool } from "./agent-registry.js";
import { workspaceCapabilities } from "./permissions.js";

function policyError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function agentWriteToolsEnabled(ctx) {
  return ctx.persistence.auth?.getAgentConfiguration
    ? ctx.persistence.auth.getAgentConfiguration().then((config) => config.writeToolsEnabled !== false)
    : Promise.resolve(true);
}

export async function assertAgentWriteToolsEnabled(ctx) {
  if (await agentWriteToolsEnabled(ctx)) return;
  throw policyError("AGENT_WRITE_TOOLS_DISABLED", "系统管理员已停用 Agent 写入工具；读取功能仍可使用", 403);
}

export function agentToolSuccess(tool, data) {
  return { ok: true, tool, ...data };
}

export function agentToolFailure(error, tool) {
  return {
    ok: false,
    tool,
    code: error.code || "AGENT_FAILED",
    message: error.message || "Agent 工具执行失败"
  };
}

function present(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateArguments(definition, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw policyError("AGENT_TOOL_ARGUMENT_INVALID", "工具参数必须是对象");
  }
  const allowed = new Set(definition.arguments);
  if (Object.keys(args).some((key) => !allowed.has(key))) {
    throw policyError("AGENT_TOOL_ARGUMENT_INVALID", "工具参数不合法");
  }
  if (definition.exclusive) {
    const filled = definition.exclusive.filter((key) => present(args[key]));
    if (filled.length !== 1) {
      throw policyError("AGENT_TOOL_ARGUMENT_INVALID", "请提供 taskId 或任务标题关键词其中之一");
    }
  }
}

function assertCapability(definition, context) {
  const caps = workspaceCapabilities(context);
  if (definition.capability === "report" && !caps.report) {
    throw policyError("REPORT_FORBIDDEN", "当前空间无报告读取权限", 403);
  }
  if (definition.capability === "create" && !caps.create) {
    throw policyError("AGENT_CREATE_FORBIDDEN", "当前角色不能在工作区创建任务", 403);
  }
  if (definition.capability === "teamManage" && !caps.manage) {
    throw policyError("AGENT_WORKSPACE_MANAGEMENT_REQUIRED", "仅工作区所有者或管理员可使用该 Agent 工具", 403);
  }
}

export async function authorizeAgentTool(ctx, context, name, args = {}) {
  const definition = getAgentTool(name);
  if (!definition) throw policyError("AGENT_TOOL_NOT_ALLOWED", "只读 Agent 不支持该工具");
  validateArguments(definition, args);
  if (AGENT_WRITE_TOOLS.includes(name)) await assertAgentWriteToolsEnabled(ctx);
  assertCapability(definition, context);
  return definition;
}
