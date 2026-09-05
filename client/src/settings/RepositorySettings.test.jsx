import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RepositorySettings from "./RepositorySettings.jsx";

function jsonOk(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body
  });
}

describe("RepositorySettings", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/?page=settings&section=github&installation_id=99&setup_action=install");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
  });

  it("GitHub 安装回跳会自动保存连接并清掉回跳参数", async () => {
    const fetchMock = vi.fn((path, options = {}) => {
      const method = options.method || "GET";
      if (path === "/api/connections" && method === "GET") return jsonOk({ connections: [] });
      if (path === "/api/repositories") return jsonOk({ repositories: [] });
      if (path === "/api/connections/github/install") return jsonOk({ configured: true, installUrl: "https://github.com/apps/nmtaskboard-dev/installations/new" });
      if (path === "/api/connections" && method === "POST") {
        const body = JSON.parse(options.body);
        return jsonOk({ connection: { id: "c1", provider: "github_app", installationId: body.installationId, accountLogin: "", status: "active" } }, 201);
      }
      return Promise.reject(new Error(`未 stub：${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RepositorySettings section="github" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/connections", expect.objectContaining({ method: "POST" })));
    const posted = fetchMock.mock.calls.find(([path, options]) => path === "/api/connections" && options?.method === "POST");
    expect(JSON.parse(posted[1].body)).toMatchObject({ provider: "github_app", installationId: "99" });
    await waitFor(() => expect(window.location.search).not.toMatch(/installation_id/));
    expect(await screen.findByText("GitHub 连接已保存")).toBeInTheDocument();
  });
});
