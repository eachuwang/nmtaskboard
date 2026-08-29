import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReportVersionsDrawer from "./ReportVersionsDrawer.jsx";

const jsonResponse = (status, body) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));

const VERSIONS = [
  { id: "v2", reportType: "weekly", rangeStart: "2026-08-24", rangeEnd: "2026-08-28", subject: "personal", source: "ai", model: "gpt-4", authorDisplayName: "管理员", createdAt: "2026-08-28T10:00:00.000Z" },
  { id: "v1", reportType: "weekly", rangeStart: "2026-08-24", rangeEnd: "2026-08-28", subject: "personal", source: "deterministic", model: null, authorDisplayName: "管理员", createdAt: "2026-08-28T09:00:00.000Z" }
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReportVersionsDrawer", () => {
  it("列出版本、查看证据、恢复到草稿且不删历史", async () => {
    const onRestore = vi.fn();
    vi.stubGlobal("fetch", vi.fn((path) => {
      const clean = path.split("?")[0];
      if (clean === "/api/report/versions") return jsonResponse(200, { versions: VERSIONS });
      if (clean === "/api/report/versions/v1") return jsonResponse(200, { version: { ...VERSIONS[1], draftText: "第一版草稿", evidenceSummary: { schemaVersion: "report-evidence/v1" } } });
      if (clean === "/api/report/versions/v1/restore") return jsonResponse(200, { version: { ...VERSIONS[1], draftText: "第一版草稿", evidenceSummary: { schemaVersion: "report-evidence/v1" } } });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportVersionsDrawer reportType="weekly" range={{ start: "2026-08-24", end: "2026-08-28" }} onRestore={onRestore} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/确定性原稿/)).toBeInTheDocument());
    expect(screen.getByText(/AI 优化/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "证据" })[1]);
    await waitFor(() => expect(screen.getByText(/report-evidence\/v1/)).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "恢复" })[1]);
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(onRestore.mock.calls[0][0].draftText).toBe("第一版草稿");
  });

  it("选择两个版本对比差异并展示增删行", async () => {
    const onRestore = vi.fn();
    vi.stubGlobal("fetch", vi.fn((path) => {
      const clean = path.split("?")[0];
      if (clean === "/api/report/versions") return jsonResponse(200, { versions: VERSIONS });
      if (clean === "/api/report/versions/v1/diff/v2") return jsonResponse(200, { from: VERSIONS[1], to: VERSIONS[0], diff: { added: 2, removed: 1, lines: [{ type: "del", text: "旧" }, { type: "add", text: "新A" }, { type: "add", text: "新B" }] } });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<ReportVersionsDrawer reportType="weekly" range={{ start: "2026-08-24", end: "2026-08-28" }} onRestore={onRestore} onClose={() => {}} />);

    const checkboxes = await screen.findAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "对比差异" }));

    await waitFor(() => expect(screen.getByText(/新增 2 行，删除 1 行/)).toBeInTheDocument());
    expect(within(screen.getByRole("dialog", { name: "版本差异" })).getByText("+新A")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "版本差异" })).getByText("-旧")).toBeInTheDocument();
  });

  it("无版本时展示空态", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(200, { versions: [] })));
    render(<ReportVersionsDrawer reportType="weekly" range={{ start: "2026-08-24", end: "2026-08-28" }} onRestore={() => {}} onClose={() => {}} />);
    expect(await screen.findByText("暂无保存的报告版本。")).toBeInTheDocument();
  });
});
