import { useState } from "react";
import RadialRevealButton from "../../components/RadialRevealButton.jsx";
import ProtoShell, { LlmPanel } from "./ProtoChrome.jsx";

export const VARIANT_C_NAME = "分栏档案视图";

export default function VariantC({ state, dispatch, tab, onNav }) {
  const [selectedPendingId, setSelectedPendingId] = useState(state.pending[0]?.id || "");
  const [selectedUserId, setSelectedUserId] = useState(state.users[0]?.id || "");

  const currentPending = state.pending.find((p) => p.id === selectedPendingId) || state.pending[0];
  const currentUser = state.users.find((u) => u.id === selectedUserId) || state.users[0];

  return (
    <ProtoShell navActive={tab} onNav={onNav} state={state}>
      {tab === "review" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="proto-section-head">
            <div className="proto-section-title">
              <h2>申请审批工作台</h2>
              <p>左侧选择申请人，右侧核对档案并执行审核。</p>
            </div>
          </div>

          <div className="proto-master-detail-layout">
            <aside className="proto-master-list" aria-label="待审核列表">
              {state.pending.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
                  队列中暂无申请
                </div>
              ) : (
                state.pending.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`proto-master-item${p.id === currentPending?.id ? " is-selected" : ""}`}
                    onClick={() => setSelectedPendingId(p.id)}
                  >
                    <div className="proto-avatar" style={{ width: 36, height: 36, fontSize: 14 }}>
                      {p.displayName.slice(0, 1)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                      <strong style={{ fontSize: 13 }}>{p.displayName}</strong>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.email}
                      </span>
                    </div>
                    <span className="proto-badge is-pending" style={{ fontSize: 10 }}>待审</span>
                  </button>
                ))
              )}
            </aside>

            <main>
              {currentPending ? (
                <div className="proto-detail-card">
                  <div className="proto-detail-header">
                    <div className="proto-detail-avatar">
                      {currentPending.displayName.slice(0, 1)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{currentPending.displayName}</h2>
                        <span className="proto-badge is-pending">等待管理员审批</span>
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-secondary)" }}>{currentPending.email}</span>
                    </div>
                  </div>

                  <div className="proto-detail-fields">
                    <div className="proto-detail-field">
                      <label>申请提交时间</label>
                      <span>{currentPending.submittedAt}</span>
                    </div>
                    <div className="proto-detail-field">
                      <label>访问范围</label>
                      <span>全内网实例（通过后可创建/受邀加入团队）</span>
                    </div>
                    <div className="proto-detail-field">
                      <label>登录权限</label>
                      <span>目前锁定中（尚未授权）</span>
                    </div>
                    <div className="proto-detail-field">
                      <label>账号类型</label>
                      <span>标准成员</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, borderTop: "1px solid var(--border-l1)", paddingTop: 20 }}>
                    <RadialRevealButton
                      className="create-button"
                      variant="solid"
                      onClick={() => {
                        dispatch({ type: "approve", id: currentPending.id });
                        setSelectedPendingId(state.pending[1]?.id || "");
                      }}
                    >
                      通过审核并授权
                    </RadialRevealButton>
                    <RadialRevealButton
                      className="create-button"
                      variant="danger"
                      onClick={() => {
                        dispatch({ type: "reject", id: currentPending.id });
                        setSelectedPendingId(state.pending[1]?.id || "");
                      }}
                    >
                      拒绝本次申请
                    </RadialRevealButton>
                  </div>
                </div>
              ) : (
                <div style={{ padding: 60, textAlign: "center", color: "var(--text-secondary)", background: "var(--glass-surface-bg)", borderRadius: 18, border: "1px dashed var(--border-l2)" }}>
                  请从左侧选择一条申请记录
                </div>
              )}
            </main>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="proto-section-head">
            <div className="proto-section-title">
              <h2>员工档案与账号安全</h2>
              <p>查看已激活员工的基本信息并支持安全重置密码。</p>
            </div>
          </div>

          <div className="proto-master-detail-layout">
            <aside className="proto-master-list" aria-label="用户列表">
              {state.users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={`proto-master-item${u.id === currentUser?.id ? " is-selected" : ""}`}
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <div className="proto-avatar is-approved" style={{ width: 36, height: 36, fontSize: 14 }}>
                    {u.displayName.slice(0, 1)}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: 13 }}>{u.displayName}</strong>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {u.email}
                    </span>
                  </div>
                </button>
              ))}
            </aside>

            <main>
              {currentUser ? (
                <div className="proto-detail-card">
                  <div className="proto-detail-header">
                    <div className="proto-detail-avatar" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--success) 25%, transparent), color-mix(in srgb, var(--success) 8%, transparent))", borderColor: "color-mix(in srgb, var(--success) 35%, transparent)" }}>
                      {currentUser.displayName.slice(0, 1)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{currentUser.displayName}</h2>
                        <span className="proto-badge is-user">正常使用中</span>
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-secondary)" }}>{currentUser.email}</span>
                    </div>
                  </div>

                  <div className="proto-detail-fields">
                    <div className="proto-detail-field">
                      <label>激活日期</label>
                      <span>{currentUser.approvedAt}</span>
                    </div>
                    <div className="proto-detail-field">
                      <label>所属空间</label>
                      <span>可由团队负责人自行邀请</span>
                    </div>
                    <div className="proto-detail-field">
                      <label>账号状态</label>
                      <span>已启用（支持密码登录）</span>
                    </div>
                    <div className="proto-detail-field">
                      <label>信息变更策略</label>
                      <span>姓名与邮箱受安全保护（不可修改）</span>
                    </div>
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-l1)", paddingTop: 20 }}>
                    <RadialRevealButton
                      className="create-button"
                      variant="outline"
                      onClick={() => dispatch({ type: "reset", id: currentUser.id })}
                    >
                      生成一次性重置密码
                    </RadialRevealButton>
                  </div>
                </div>
              ) : null}
            </main>
          </div>
        </div>
      )}

      {tab === "llm" && <LlmPanel state={state} dispatch={dispatch} />}
    </ProtoShell>
  );
}
