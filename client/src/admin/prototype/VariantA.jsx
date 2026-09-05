import { useState } from "react";
import RadialRevealButton from "../../components/RadialRevealButton.jsx";
import ProtoShell, { LlmPanel } from "./ProtoChrome.jsx";

export const VARIANT_A_NAME = "卡片流布局";

export default function VariantA({ state, dispatch, tab, onNav }) {
  const [query, setQuery] = useState("");

  const pendingList = state.pending.filter((p) =>
    !query.trim() || p.displayName.includes(query) || p.email.includes(query)
  );
  const userList = state.users.filter((u) =>
    !query.trim() || u.displayName.includes(query) || u.email.includes(query)
  );

  return (
    <ProtoShell navActive={tab} onNav={onNav} state={state}>
      {tab === "review" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="proto-section-head">
            <div className="proto-section-title">
              <h2>用户注册审核队列</h2>
              <p>内网用户提交注册后进入待审状态，审批通过后方可登录系统。</p>
            </div>
            <input
              type="search"
              className="proto-search-input"
              placeholder="搜索姓名或邮箱…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {pendingList.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text-secondary)", background: "var(--glass-surface-bg)", borderRadius: 18, border: "1px dashed var(--border-l2)" }}>
              {query ? "未找到匹配的待审核记录" : "目前没有待审核的注册申请，队列已清空。"}
            </div>
          ) : (
            <div className="proto-card-stream">
              {pendingList.map((item) => (
                <article className="proto-stream-card" key={item.id}>
                  <div className="proto-user-lead">
                    <div className="proto-avatar">
                      {item.displayName.slice(0, 1)}
                    </div>
                    <div className="proto-user-meta">
                      <div className="proto-user-meta-top">
                        <strong>{item.displayName}</strong>
                        <span className="proto-badge is-pending">待审批</span>
                      </div>
                      <span className="proto-user-email">{item.email}</span>
                      <span className="proto-user-date">提交时间：{item.submittedAt}</span>
                    </div>
                  </div>
                  <div className="proto-actions">
                    <RadialRevealButton
                      className="create-button"
                      variant="solid"
                      onClick={() => dispatch({ type: "approve", id: item.id })}
                    >
                      通过申请
                    </RadialRevealButton>
                    <RadialRevealButton
                      className="create-button"
                      variant="danger"
                      onClick={() => dispatch({ type: "reject", id: item.id })}
                    >
                      拒绝
                    </RadialRevealButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "users" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="proto-section-head">
            <div className="proto-section-title">
              <h2>已激活用户管理</h2>
              <p>已审核通过的内网用户列表。支持由管理员一键生成一次性临时重置密码。</p>
            </div>
            <input
              type="search"
              className="proto-search-input"
              placeholder="搜索姓名或邮箱…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {userList.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text-secondary)", background: "var(--glass-surface-bg)", borderRadius: 18, border: "1px dashed var(--border-l2)" }}>
              未找到匹配的用户
            </div>
          ) : (
            <div className="proto-card-stream">
              {userList.map((user) => (
                <article className="proto-stream-card" key={user.id}>
                  <div className="proto-user-lead">
                    <div className="proto-avatar is-approved">
                      {user.displayName.slice(0, 1)}
                    </div>
                    <div className="proto-user-meta">
                      <div className="proto-user-meta-top">
                        <strong>{user.displayName}</strong>
                        <span className="proto-badge is-user">已就绪</span>
                      </div>
                      <span className="proto-user-email">{user.email}</span>
                      <span className="proto-user-date">加入日期：{user.approvedAt}</span>
                    </div>
                  </div>
                  <div className="proto-actions">
                    <RadialRevealButton
                      type="button"
                      className="settings-button"
                      variant="outline"
                      onClick={() => dispatch({ type: "reset", id: user.id })}
                    >
                      重置密码
                    </RadialRevealButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "llm" && <LlmPanel state={state} dispatch={dispatch} />}
    </ProtoShell>
  );
}
