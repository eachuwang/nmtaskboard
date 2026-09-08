import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HelpView from "./HelpView.jsx";

describe("HelpView", () => {
  it("渲染帮助标题与全部章节", () => {
    render(<HelpView />);
    expect(screen.getByRole("heading", { name: "使用帮助" })).toBeInTheDocument();
    for (const title of ["欢迎使用牛马任务看板", "任务看板", "卡片与任务详情", "项目", "协作、团队与角色", "收件箱与周报", "快捷键与小贴士"]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/Ctrl \+ 鼠标滚轮/)).toBeInTheDocument();
  });
});
