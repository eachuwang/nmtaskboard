import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReportView from "./ReportView.jsx";
import { resetSession } from "./reportSession.js";

const jsonResponse = (status, body) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));

const SUMMARY = {
  sections: { completed: [], inProgress: [], blocked: [], created: [] },
  nextWeek: [],
  diagnostics: { excluded: [] }
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReportView 报告工具栏与时区", () => {
  it("工作区报告工具栏只保留时区，不重复主体和空间名", async () => {
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "America/Los_Angeles" });
      if (path === "/api/auth/session") return jsonResponse(200, {
        actor: { id: "owner-1", displayName: "管理员" },
        workspace: { id: "team-1", type: "workspace", name: "产品团队", role: "owner", timeZone: "Asia/Shanghai" }
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    const controls = await screen.findByLabelText("报告控制");
    await waitFor(() => expect(within(controls).getByText("Asia/Shanghai")).toBeInTheDocument());
    expect(within(controls).queryByText("团队报告")).not.toBeInTheDocument();
    expect(within(controls).queryByText("产品团队")).not.toBeInTheDocument();
  });

  it("没有工作区时区时回退到个人设置时区", async () => {
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "America/Los_Angeles" });
      if (path === "/api/auth/session") return jsonResponse(200, {
        actor: { id: "owner-1", displayName: "管理员" },
        workspace: { id: "ws-1", type: "workspace", name: "个人空间", role: "owner", timeZone: null }
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    await waitFor(() => expect(screen.getByText("America/Los_Angeles")).toBeInTheDocument());
    expect(screen.queryByText("个人空间")).not.toBeInTheDocument(); // 工具栏不重复空间名
  });

  it("工作区时区变更后报告页自动刷新时区", async () => {
    let sessionCalls = 0;
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "America/Los_Angeles" });
      if (path === "/api/auth/session") {
        sessionCalls += 1;
        return jsonResponse(200, {
          actor: { id: "owner-1", displayName: "管理员" },
          workspace: { id: "team-1", type: "workspace", name: "产品团队", role: "owner", timeZone: sessionCalls === 1 ? "Asia/Shanghai" : "Europe/Berlin" }
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    await waitFor(() => expect(screen.getByText("Asia/Shanghai")).toBeInTheDocument());
    window.dispatchEvent(new CustomEvent("tb-workspace-updated"));
    await waitFor(() => expect(screen.getByText("Europe/Berlin")).toBeInTheDocument());
  });

  it("切换空间时清空已生成的报告草稿与勾选", async () => {
    vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "Asia/Shanghai" });
      if (path === "/api/auth/session") return jsonResponse(200, {
        actor: { id: "owner-1", displayName: "管理员" },
        workspace: { id: "team-1", type: "workspace", name: "产品团队", role: "owner", timeZone: "Asia/Shanghai" }
      });
      if (path === "/api/report/template" && options.method === "POST") {
        return jsonResponse(200, { type: "weekly", subject: "workspace", timeZone: "Asia/Shanghai", summary: SUMMARY, report: "生成的工作周报内容" });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    const loadButton = await screen.findByRole("button", { name: "从看板生成周报" });
    fireEvent.click(loadButton);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await waitFor(() => expect(screen.getByLabelText("报告内容")).toHaveValue("生成的工作周报内容"));

    window.dispatchEvent(new CustomEvent("tb-workspace-changing"));
    await waitFor(() => expect(screen.getByLabelText("报告内容")).toHaveValue(""));
    expect(await screen.findByRole("button", { name: "从看板生成周报" })).toBeInTheDocument();
  });

  it("预览按编辑所见即所得：单换行渲染为换行而非折叠为空格", async () => {
    localStorage.clear();
    resetSession();
    vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "Asia/Shanghai" });
      if (path === "/api/auth/session") return jsonResponse(200, {
        actor: { id: "owner-1", displayName: "管理员" },
        workspace: { id: "team-1", type: "workspace", name: "产品团队", role: "owner", timeZone: "Asia/Shanghai" }
      });
      if (path === "/api/report/template" && options.method === "POST") {
        return jsonResponse(200, {
          type: "weekly", subject: "workspace", timeZone: "Asia/Shanghai", summary: SUMMARY,
          report: "本周进展\n完成登录模块\n细节：修复三个bug"
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    fireEvent.click(await screen.findByRole("button", { name: "从看板生成周报" }));
    const preview = await screen.findByLabelText("报告内容预览");
    // remark-breaks：两个单换行 → 两个 <br>；修复前整段折叠成一行
    await waitFor(() => expect(preview.querySelectorAll("br").length).toBe(2));
  });

  it("生成后切换范围开关：内容保留并出现参数已变提示，重新生成按新范围发起", async () => {
    localStorage.clear();
    resetSession();
    const bodies = [];
    vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "Asia/Shanghai" });
      if (path === "/api/auth/session") return jsonResponse(200, {
        actor: { id: "owner-1", displayName: "管理员" },
        workspace: { id: "team-1", type: "workspace", name: "产品团队", role: "owner", timeZone: "Asia/Shanghai" }
      });
      if (path === "/api/report/template" && options.method === "POST") {
        bodies.push(JSON.parse(options.body));
        return jsonResponse(200, { type: "weekly", subject: "workspace", timeZone: "Asia/Shanghai", summary: SUMMARY, report: "工作区范围的内容" });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    fireEvent.click(await screen.findByRole("button", { name: "从看板生成周报" }));
    await screen.findByText("工作区范围的内容");

    // 切换到个人报告：参数变化不重置内容（修复前：draft 被重置为骨架）
    fireEvent.click(screen.getByRole("button", { name: "个人报告" }));
    expect(screen.getByText("工作区范围的内容")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("参数已变")).toBeInTheDocument());

    // 重新生成：按新范围发起且提示消失
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    await waitFor(() => expect(bodies.length).toBe(2));
    expect(bodies[1].scope).toBe("personal");
    await waitFor(() => expect(screen.queryByText("参数已变")).not.toBeInTheDocument());
  });
});
