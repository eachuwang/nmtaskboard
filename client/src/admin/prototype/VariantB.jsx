import { useState } from "react";
import RadialRevealButton from "../../components/RadialRevealButton.jsx";
import ProtoShell, { LlmPanel } from "./ProtoChrome.jsx";

export const VARIANT_B_NAME = "数据表格";

export default function VariantB({ state, dispatch, tab, onNav }) {
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
              <h2>待审核注册清单</h2>
              <p>内网用户提交注册后进入待审状态，审批通过后方可登录。</p>
            </div>
            <input
              type="search"
              className="proto-search-input"
              placeholder="搜索待审人员…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="proto-glass-table-wrapper">
            <table className="proto-glass-table">
              <thead>
                <tr>
                  <th style={{ width: 180 }}>申请人</th>
                  <th>内网邮箱 (账号)</th>
                  <th style={{ width: 160 }}>申请时间</th>
                  <th style={{ width: 100 }}>状态</th>
                  <th style={{ width: 180, textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pendingList.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "36px 0", color: "var(--text-secondary)" }}>
                      {query ? "未找到匹配申请" : "暂无待审核申请"}
                    </td>
                  </tr>
                ) : (
                  pendingList.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="proto-avatar" style={{ width: 30, height: 30, fontSize: 13, borderRadius: 8 }}>
                            {row.displayName.slice(0, 1)}
                          </div>
                          <strong>{row.displayName}</strong>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{row.email}</span>
                      </td>
                      <td>
                        <span style={{ color: "var(--text-caption)", fontSize: 12 }}>{row.submittedAt}</span>
                      </td>
                      <td>
                        <span className="proto-badge is-pending">待审批</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <RadialRevealButton className="create-button" variant="solid" style={{ height: 28, padding: "0 10px", fontSize: 12 }} onClick={() => dispatch({ type: "approve", id: row.id })}>通过</RadialRevealButton>
                          <RadialRevealButton className="create-button" variant="danger" style={{ height: 28, padding: "0 10px", fontSize: 12 }} onClick={() => dispatch({ type: "reject", id: row.id })}>拒绝</RadialRevealButton>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="proto-section-head">
            <div className="proto-section-title">
              <h2>系统用户花名册</h2>
              <p>已授权访问看板的员工账号。不可改显示名或邮箱，可重置一次性密码。</p>
            </div>
            <input
              type="search"
              className="proto-search-input"
              placeholder="搜索用户…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="proto-glass-table-wrapper">
            <table className="proto-glass-table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>用户</th>
                  <th>内网登录名 (邮箱)</th>
                  <th style={{ width: 160 }}>激活日期</th>
                  <th style={{ width: 100 }}>账号状态</th>
                  <th style={{ width: 140, textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {userList.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "36px 0", color: "var(--text-secondary)" }}>暂无匹配用户</td>
                  </tr>
                ) : (
                  userList.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="proto-avatar is-approved" style={{ width: 30, height: 30, fontSize: 13, borderRadius: 8 }}>
                            {user.displayName.slice(0, 1)}
                          </div>
                          <strong>{user.displayName}</strong>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{user.email}</span>
                      </td>
                      <td>
                        <span style={{ color: "var(--text-caption)", fontSize: 12 }}>{user.approvedAt}</span>
                      </td>
                      <td>
                        <span className="proto-badge is-user">正常</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => dispatch({ type: "reset", id: user.id })}>重置密码</RadialRevealButton>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "llm" && <LlmPanel state={state} dispatch={dispatch} />}
    </ProtoShell>
  );
}
