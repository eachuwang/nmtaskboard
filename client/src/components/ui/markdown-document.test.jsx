import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MarkdownDocument } from "./markdown-document.jsx";

it("renders task lists as read-only checkboxes while preserving ordinary lists", () => {
  render(<div className="board-edit-form"><MarkdownDocument source={"- [ ] 测试8\n- [x] 测试9\n\n1. 普通编号\n2. 第二项"} /></div>);
  expect(screen.getByRole("checkbox", { name: "未完成" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "已完成" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "已完成" })).toBeDisabled();
  expect(screen.getByText("普通编号").closest("ol")).not.toBeNull();
});
