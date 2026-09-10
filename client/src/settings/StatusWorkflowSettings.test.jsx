import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import StatusWorkflowSettings from "./StatusWorkflowSettings.jsx";
import { defaultWorkflow, DEFAULT_STATUSES } from "../../../shared/task-statuses.js";
import { requestJson } from "../lib/http.js";
vi.mock("../lib/http.js", () => ({ requestJson: vi.fn() }));
vi.mock("../lib/toast.js", () => ({ toast: vi.fn() }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });
function mockRequests(role = "owner") {
  requestJson.mockImplementation(async (url, options) => {
    if (url === "/api/auth/session") return { workspace: { role } };
    if (url === "/api/status-workflow/preview") {
      const body = JSON.parse(options.body);
      return { ready: true, token: "preview", rows: [], affected: 0, reopened: 0, ended: 0, before: { progress: null }, after: { progress: null } };
    }
    if (options?.method === "PUT") return { workflow: { ...JSON.parse(options.body), revision: 1 } };
    return { workflow: defaultWorkflow() };
  });
}
test("默认方案只读；用户编辑自定义后必须预览确认才写入", async () => {
  mockRequests();
  render(<StatusWorkflowSettings />);
  expect(await screen.findByRole("textbox", { name: "状态名称 待整理" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "生命周期 待整理" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "使用自定义方案" }));
  const field = screen.getByRole("textbox", { name: "状态名称 待整理" });
  expect(field).not.toBeDisabled();
  fireEvent.change(field, { target: { value: "待分配" } });
  expect(requestJson.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "预览变更" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认保存并应用" }));
  await waitFor(() => expect(requestJson.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(true));
  const saved = JSON.parse(requestJson.mock.calls.find(([, options]) => options?.method === "PUT")[1].body);
  expect(saved.custom[0].name).toBe("待分配");
  expect(saved.custom[0].id).not.toBe(DEFAULT_STATUSES[0].id);
  expect(saved.previewToken).toBe("preview");
});
test("普通成员只能查看方案，不能切换或编辑默认列", async () => {
  mockRequests("member"); render(<StatusWorkflowSettings />);
  expect(await screen.findByRole("textbox", { name: "状态名称 待整理" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "使用自定义方案" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "预览变更" })).not.toBeInTheDocument();
});
