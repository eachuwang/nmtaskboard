// PROTOTYPE — throwaway. In-memory stub for admin console UI variants.
// Question: What should the built-in admin review + user + instance LLM page look like?

export const INITIAL_ADMIN_STATE = {
  pending: [
    { id: "p1", displayName: "陈可", email: "chenke@lines.local", submittedAt: "2026-08-31 09:12" },
    { id: "p2", displayName: "林晓", email: "linxiao@lines.local", submittedAt: "2026-08-31 11:40" },
    { id: "p3", displayName: "马修", email: "maxiu@lines.local", submittedAt: "2026-08-30 18:02" }
  ],
  users: [
    { id: "u1", displayName: "王敏", email: "wangmin@lines.local", approvedAt: "2026-08-20" },
    { id: "u2", displayName: "赵衡", email: "zhaoheng@lines.local", approvedAt: "2026-08-22" },
    { id: "u3", displayName: "苏青", email: "suqing@lines.local", approvedAt: "2026-08-28" }
  ],
  llm: {
    defaultProviderId: "deepseek",
    temperature: 0.7,
    providers: [
      { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", hasKey: true, keyTail: "…k2p9", defaultModelId: "deepseek-chat" },
      { id: "qwen", name: "通义", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", hasKey: false, keyTail: "", defaultModelId: "qwen-plus" }
    ]
  },
  revealedPassword: null,
  lastAction: "已加载示例数据（不写库）"
};

export function reduceAdmin(state, action) {
  if (action.type === "approve") {
    const row = state.pending.find((item) => item.id === action.id);
    if (!row) return state;
    return {
      ...state,
      pending: state.pending.filter((item) => item.id !== action.id),
      users: [{ id: `u-${row.id}`, displayName: row.displayName, email: row.email, approvedAt: "刚刚" }, ...state.users],
      revealedPassword: null,
      lastAction: `通过 ${row.email}`
    };
  }
  if (action.type === "reject") {
    const row = state.pending.find((item) => item.id === action.id);
    if (!row) return state;
    return {
      ...state,
      pending: state.pending.filter((item) => item.id !== action.id),
      revealedPassword: null,
      lastAction: `拒绝 ${row.email}（对方可用同一邮箱再提交）`
    };
  }
  if (action.type === "reset") {
    const row = state.users.find((item) => item.id === action.id);
    if (!row) return state;
    const password = `Tmp-${Math.random().toString(36).slice(2, 10)}-x`;
    return {
      ...state,
      revealedPassword: { email: row.email, password },
      lastAction: `重置 ${row.email} 的密码（只显示一次）`
    };
  }
  if (action.type === "dismiss-password") {
    return { ...state, revealedPassword: null };
  }
  if (action.type === "save-llm") {
    return { ...state, llm: action.llm, lastAction: "保存实例 LLM（内存，刷新即丢）" };
  }
  return state;
}
