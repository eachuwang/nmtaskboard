export function agentWriteToolsEnabled(ctx) {
  return ctx.persistence.auth?.getAgentConfiguration
    ? ctx.persistence.auth.getAgentConfiguration().then((config) => config.writeToolsEnabled !== false)
    : Promise.resolve(true);
}

export async function assertAgentWriteToolsEnabled(ctx) {
  if (await agentWriteToolsEnabled(ctx)) return;
  throw Object.assign(new Error("系统管理员已停用 Agent 写入工具；读取功能仍可使用"), {
    code: "AGENT_WRITE_TOOLS_DISABLED",
    statusCode: 403
  });
}
