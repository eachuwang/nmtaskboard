import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReportView from "./ReportView.jsx";

const jsonResponse = (status, body) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));

const SUMMARY = {
  sections: { completed: [], inProgress: [], blocked: [], created: [] },
  nextWeek: [],
  diagnostics: { excluded: [] }
};

function setupPortal() {
  const slot = document.createElement("div");
  slot.id = "shell-report-tools-slot";
  document.body.appendChild(slot);
  return slot;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getElementById("shell-report-tools-slot")?.remove();
});

describe("ReportView 报告工具栏与时区", () => {
  it("团队空间隐藏重复的报告主体和空间名，保留团队时区", async () => {
    const slot = setupPortal();
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "America/Los_Angeles" });
      if (path === "/api/auth/session") return jsonResponse(200, {
        actor: { id: "owner-1", displayName: "管理员" },
        workspace: { id: "team-1", type: "team", name: "产品团队", role: "owner", timeZone: "Asia/Shanghai" }
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    await waitFor(() => expect(screen.getByText("Asia/Shanghai")).toBeInTheDocument());
    expect(within(slot).queryByText("团队报告")).not.toBeInTheDocument();
    expect(within(slot).queryByText("产品团队")).not.toBeInTheDocument();
  });

  it("个人空间隐藏重复的报告主体和空间名，保留个人设置时区", async () => {
    const slot = setupPortal();
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "America/Los_Angeles" });
      if (path === "/api/auth/session") return jsonResponse(200, {
        actor: { id: "owner-1", displayName: "管理员" },
        workspace: { id: "personal-1", type: "personal", name: "个人空间", role: "owner", timeZone: null }
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    await waitFor(() => expect(screen.getByText("America/Los_Angeles")).toBeInTheDocument());
    expect(within(slot).queryByText("个人报告")).not.toBeInTheDocument();
    expect(within(slot).queryByText("个人空间")).not.toBeInTheDocument();
  });

  it("团队时区变更后报告页自动刷新时区", async () => {
    setupPortal();
    let sessionCalls = 0;
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "America/Los_Angeles" });
      if (path === "/api/auth/session") {
        sessionCalls += 1;
        return jsonResponse(200, {
          actor: { id: "owner-1", displayName: "管理员" },
          workspace: { id: "team-1", type: "team", name: "产品团队", role: "owner", timeZone: sessionCalls === 1 ? "Asia/Shanghai" : "Europe/Berlin" }
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
    setupPortal();
    vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
      if (path === "/api/llm/status") return jsonResponse(200, { configured: false });
      if (path === "/api/settings") return jsonResponse(200, { providers: [], reportTimeZone: "Asia/Shanghai" });
      if (path === "/api/auth/session") return jsonResponse(200, {
        actor: { id: "owner-1", displayName: "管理员" },
        workspace: { id: "team-1", type: "team", name: "产品团队", role: "owner", timeZone: "Asia/Shanghai" }
      });
      if (path === "/api/report/template" && options.method === "POST") {
        return jsonResponse(200, { type: "weekly", subject: "team", timeZone: "Asia/Shanghai", summary: SUMMARY, report: "生成的工作周报内容" });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportView />);

    const loadButton = await screen.findByRole("button", { name: "点我读取看板" });
    fireEvent.click(loadButton);
    await waitFor(() => expect(screen.getByLabelText("报告内容")).toHaveValue("生成的工作周报内容"));

    window.dispatchEvent(new CustomEvent("tb-workspace-changing"));
    await waitFor(() => expect(screen.getByLabelText("报告内容")).toHaveValue(""));
    expect(await screen.findByRole("button", { name: "点我读取看板" })).toBeInTheDocument();
  });
});
