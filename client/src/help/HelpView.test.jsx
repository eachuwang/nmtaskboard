import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import HelpView from "./HelpView.jsx";
import { HELP_ARTICLES, HELP_GROUPS } from "./articles.js";
const navigate = (hash) => act(() => { window.history.pushState({}, "", hash); window.dispatchEvent(new Event("hashchange")); });
beforeEach(() => window.history.replaceState({}, "", "/?page=help"));
afterEach(cleanup);

describe("HelpView", () => {
  it("分组导航覆盖文章并展示欢迎页", () => {
    render(<HelpView />);
    expect(screen.getByRole("heading", { name: "欢迎使用牛马任务看板" })).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "帮助文档目录" }));
    for (const article of HELP_ARTICLES) expect(nav.getByRole("link", { name: article.title })).toHaveAttribute("href", `#help/${article.id}`);
    expect(HELP_GROUPS.flatMap((group) => group.ids).sort()).toEqual(HELP_ARTICLES.map((article) => article.id).sort());
  });
  it("支持深链接、页内目录和返回之前的文章", () => {
    window.history.replaceState({}, "", "/?page=help#help/statuses/lifecycle");
    render(<HelpView />);
    expect(screen.getByRole("heading", { name: "状态流程", exact: true })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "本页章节" })).getByRole("link", { name: "四类生命周期" })).toHaveAttribute("aria-current", "location");
    navigate("#help/reports");
    expect(screen.getByRole("heading", { name: "报告", exact: true })).toBeInTheDocument();
    navigate("#help/statuses/lifecycle");
    expect(screen.getByRole("heading", { name: "四类生命周期", exact: true })).toBeInTheDocument();
  });
  it("搜索正文、显示无结果并可清除搜索", () => {
    render(<HelpView />);
    const search = screen.getByRole("searchbox", { name: "搜索帮助文档" });
    fireEvent.change(search, { target: { value: "不补写开工" } });
    const nav = within(screen.getByRole("navigation", { name: "帮助文档目录" }));
    expect(nav.getByRole("link", { name: "状态流程", exact: true })).toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "项目与代码资源" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "没有这个词xyz" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有找到相关文档");
    fireEvent.click(screen.getByRole("button", { name: "清除文档搜索" }));
    expect(nav.getByRole("link", { name: "快速上手" })).toBeInTheDocument();
  });
  it("未知链接回到欢迎页，移动目录可以展开", () => {
    window.history.replaceState({}, "", "/?page=help#help/unknown");
    render(<HelpView />);
    expect(screen.getByRole("heading", { name: "欢迎使用牛马任务看板" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "文档目录" });
    fireEvent.click(toggle); expect(toggle).toHaveAttribute("aria-expanded", "true");
    navigate("#help/quickstart"); expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
