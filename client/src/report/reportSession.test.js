// reportSession 竞态回归测试：对应修复前的三类用户可见故障——
// 1) 生成中切换参数/连点重新生成后动画消失、内容只剩骨架；2) 乱序响应数据错位；
// 3) 剔除勾选无生效路径。所有断言围绕单一契约：只有当前代际的生成能写状态。
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as S from "./reportSession.js";

const jsonRes = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const deferred = () => {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// 可控 SSE 通道：send/close 由测试驱动，signal 中止时以 AbortError 结束读取循环
function sseChannel(signal) {
  let send;
  let close;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      send = (event, data) => { try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* 已中止 */ } };
      close = () => { try { controller.close(); } catch { /* 已中止 */ } };
      signal?.addEventListener("abort", () => {
        try { controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })); } catch { /* 已结束 */ }
      });
    }
  });
  return { response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }), send, close, signal };
}

// 初始化会话：owner 角色 + 可配置 aiReady
async function initOwner({ aiReady = false } = {}) {
  const restore = globalThis.fetch;
  globalThis.fetch = vi.fn((path) => {
    if (path === "/api/auth/session") return Promise.resolve(jsonRes({ actor: { id: "a1" }, workspace: { id: "ws1", role: "owner", timeZone: "UTC" } }));
    if (path === "/api/settings") return Promise.resolve(jsonRes({ reportTimeZone: "UTC" }));
    if (path === "/api/llm/status") return Promise.resolve(jsonRes({ configured: aiReady }));
    if (path === "/api/report-templates") return Promise.resolve(jsonRes({ builtins: [], custom: [] }));
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  await S.init();
  globalThis.fetch = restore;
}

beforeEach(() => {
  localStorage.clear();
  S.resetSession();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("reportSession 生成竞态", () => {
  it.each(["", "AI 输出可能含证据外的日期/数字，请核对"])("生成结束只显示一条结果提示并保留核对信息：%s", async (warning) => {
    await initOwner({ aiReady: true });
    globalThis.fetch = vi.fn(() => {
      const channel = sseChannel();
      channel.send("delta", { text: "报告正文" });
      channel.send("done", { model: "m", warning });
      channel.close();
      return Promise.resolve(channel.response);
    });
    await S.generate();
    const notices = document.querySelectorAll(".toast");
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toContain("已按模板生成报告");
    if (warning) expect(notices[0].textContent).toContain(warning);
    expect(S.getSnapshot().draft).toBe("报告正文");
    expect(S.getSnapshot().generating).toBe(false);
  });

  it("生成中被新一次生成取代：旧流静默失效，动画标志保持到新流完成", async () => {
    await initOwner({ aiReady: true });
    const channels = [];
    globalThis.fetch = vi.fn((path, options = {}) => {
      if (path === "/api/report/fill") {
        const channel = sseChannel(options.signal);
        channels.push(channel);
        return Promise.resolve(channel.response);
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    const first = S.generate();
    await waitFor(() => expect(channels.length).toBe(1));
    channels[0].send("meta", { summary: { sections: { completed: [] } }, timeZone: "UTC" });
    channels[0].send("delta", { text: "第一段" });
    await waitFor(() => expect(S.getSnapshot().draft).toBe("第一段"));
    expect(S.getSnapshot().generating).toBe(true);

    // 用户在「无动画等待期」点击重新生成 → 新代际接管
    const second = S.generate();
    await waitFor(() => expect(channels.length).toBe(2));
    channels[0].send("delta", { text: "旧流迟到数据" });
    await tick(); await tick(); // 让旧流的 abort 微任务全部落地
    const mid = S.getSnapshot();
    expect(mid.generating).toBe(true); // 修复前：被中止的旧流 finally 会把它关掉
    expect(mid.draft).toBe("第一段"); // 旧代际的写入被丢弃

    channels[1].send("delta", { text: "新内容" });
    channels[1].send("done", { model: "m1" });
    channels[1].close();
    await Promise.allSettled([first, second]);
    const fin = S.getSnapshot();
    expect(fin.generating).toBe(false);
    expect(fin.draft).toBe("新内容");
    expect(fin.originalDraft).toBe("新内容");
    expect(fin.versionSource).toBe("ai");
    expect(fin.aiModel).toBe("m1");
    expect(S.isStale()).toBe(false);
  });

  it("无 LLM 时模板响应乱序：后到的旧响应被丢弃，不产生数据错位", async () => {
    await initOwner({ aiReady: false });
    const calls = [];
    globalThis.fetch = vi.fn((path) => {
      if (path === "/api/report/template") {
        const d = deferred();
        const idx = calls.length;
        calls.push(d);
        return d.promise.then((report) => jsonRes({ report, summary: { sections: { completed: [{ id: `t${idx}` }] } }, timeZone: "UTC" }));
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    const first = S.generate(); // 慢请求
    const second = S.generate(); // 快请求（后发起先返回）
    calls[1].resolve("新内容");
    await waitFor(() => expect(S.getSnapshot().draft).toBe("新内容"));
    calls[0].resolve("旧内容"); // 旧响应迟到
    await Promise.allSettled([first, second]);
    await tick();
    expect(S.getSnapshot().draft).toBe("新内容"); // 修复前：旧响应会覆盖新状态
    expect(S.getSnapshot().lastGen).toBeTruthy();
  });

  it("参数变更是纯状态变更：draft 不被触碰，重新生成按新参数发起", async () => {
    await initOwner({ aiReady: false });
    let body = null;
    globalThis.fetch = vi.fn((path, options = {}) => {
      if (path === "/api/report/template") {
        body = JSON.parse(options.body);
        return Promise.resolve(jsonRes({ report: "报告A", summary: { sections: { completed: [] } }, timeZone: "UTC" }));
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    await S.generate();
    expect(S.getSnapshot().draft).toBe("报告A");

    S.setScopePref("personal"); // 修复前：这里会自动重载并重置 draft
    expect(S.getSnapshot().draft).toBe("报告A");
    expect(S.isStale()).toBe(true);

    await S.generate();
    expect(S.getSnapshot().draft).toBe("报告A");
    expect(body.scope).toBe("personal");
    expect(S.isStale()).toBe(false);
  });

  it("勾选剔除任务按新清单重新生成，且勾选在重新生成后保留", async () => {
    await initOwner({ aiReady: false });
    const bodies = [];
    globalThis.fetch = vi.fn((path, options = {}) => {
      if (path === "/api/report/template") {
        bodies.push(JSON.parse(options.body));
        return Promise.resolve(jsonRes({
          report: "R",
          summary: { sections: { completed: [{ id: "t1", title: "A" }, { id: "t2", title: "B" }] } },
          timeZone: "UTC"
        }));
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    await S.generate();

    S.toggleTask("t1", false); // 勾掉 A → 自动按剔除后清单重新生成
    await waitFor(() => expect(bodies.length).toBe(2));
    expect(bodies[1].excludedTaskIds).toEqual(["t1"]);
    expect([...S.getSnapshot().excludedIds]).toEqual(["t1"]); // 修复前：重新生成会清空勾选
  });

  it("恢复原文回到最近一次生成的完整文本", async () => {
    await initOwner({ aiReady: false });
    globalThis.fetch = vi.fn((path) => {
      if (path === "/api/report/template") return Promise.resolve(jsonRes({ report: "生成的报告", summary: { sections: {} }, timeZone: "UTC" }));
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    await S.generate();
    S.onManualEdit("手动乱改");
    S.restoreDraft();
    expect(S.getSnapshot().draft).toBe("生成的报告");
  });

  it("clearReport（切换工作区）中止在途生成且不卡死动画标志", async () => {
    await initOwner({ aiReady: true });
    const channels = [];
    globalThis.fetch = vi.fn((path, options = {}) => {
      if (path === "/api/report/fill") {
        const channel = sseChannel(options.signal);
        channels.push(channel);
        return Promise.resolve(channel.response);
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const pending = S.generate();
    await waitFor(() => expect(channels.length).toBe(1));
    channels[0].send("delta", { text: "流到一半" });
    await waitFor(() => expect(S.getSnapshot().draft).toBe("流到一半"));

    S.clearReport(); // tb-workspace-changing
    expect(channels[0].signal.aborted).toBe(true);
    await Promise.allSettled([pending]);
    const snap = S.getSnapshot();
    expect(snap.generating).toBe(false); // 修复前：标志会永远卡在 true
    expect(snap.draft).toBe("");
    expect(snap.lastGen).toBeNull();
  });

  it("连续两次润色：被中止的旧润色不关闭新润色的进行中标志", async () => {
    await initOwner({ aiReady: true });
    globalThis.fetch = vi.fn((path) => {
      if (path === "/api/report/fill") {
        const channel = sseChannel();
        Promise.resolve().then(() => { channel.send("delta", { text: "草稿" }); channel.send("done", { model: "m" }); channel.close(); });
        return Promise.resolve(channel.response);
      }
      if (path === "/api/report/polish") return Promise.resolve(new Response(null, { status: 200 }));
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    await S.generate();
    await waitFor(() => expect(S.getSnapshot().draft).toBe("草稿"));

    const channels = [];
    globalThis.fetch = vi.fn((path, options = {}) => {
      if (path === "/api/report/polish") {
        const channel = sseChannel(options.signal);
        channels.push(channel);
        return Promise.resolve(channel.response);
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const first = S.polishDraft();
    await waitFor(() => expect(channels.length).toBe(1));
    const second = S.polishDraft(); // 第二次润色中止第一次
    await waitFor(() => expect(channels.length).toBe(2));
    await tick(); await tick();
    expect(S.getSnapshot().polishing).toBe(true); // 修复前：旧润色的 finally 会关掉它
    channels[1].send("delta", { text: "候选" });
    channels[1].send("done", { model: "m" });
    channels[1].close();
    await Promise.allSettled([first, second]);
    expect(S.getSnapshot().polishing).toBe(false);
    expect(S.getSnapshot().aiCandidate?.text).toBe("候选");
  });
});
