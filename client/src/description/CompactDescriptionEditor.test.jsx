import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CompactDescriptionEditor } from "./CompactDescriptionEditor.jsx";

it("previews an attachment image and preserves its source when switching modes", () => {
  const value = '![IMG_9195](attachment://image-1){size="medium" align="center" caption=""}';
  const change = vi.fn();
  render(<CompactDescriptionEditor value={value} onChange={change} />);
  expect(screen.getByRole("img", { name: "IMG_9195" })).toHaveAttribute("src", "/api/attachments/image-1?inline=1");
  fireEvent.click(screen.getByRole("button", { name: "源码" }));
  expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue(value);
  fireEvent.click(screen.getByRole("button", { name: "预览" }));
  expect(screen.getByRole("img", { name: "IMG_9195" })).toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});

it("switches from a plain draft to image preview after applying the large editor", () => {
  const { rerender } = render(<CompactDescriptionEditor value="文字" onChange={() => {}} />);
  expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("文字");
  rerender(<CompactDescriptionEditor value="![图片](attachment://image-1)" onChange={() => {}} />);
  expect(screen.getByRole("img", { name: "图片" })).toBeInTheDocument();
});
