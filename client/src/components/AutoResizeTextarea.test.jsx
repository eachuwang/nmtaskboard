import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AutoResizeTextarea from "./AutoResizeTextarea.jsx";

describe("AutoResizeTextarea", () => {
  it("默认显示五行并在八行后改为内部滚动", () => {
    const getComputedStyle = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      paddingTop: "10px",
      paddingBottom: "10px",
      borderTopWidth: "1px",
      borderBottomWidth: "1px"
    });
    const { rerender } = render(<AutoResizeTextarea aria-label="内容" value="一行" readOnly />);
    const textarea = screen.getByLabelText("内容");
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 62 });
    rerender(<AutoResizeTextarea aria-label="内容" value="两行" readOnly />);
    expect(textarea.style.height).toBe("122px");
    expect(textarea.style.overflowY).toBe("hidden");
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 240 });
    fireEvent.input(textarea);
    expect(textarea.style.height).toBe("182px");
    expect(textarea.style.overflowY).toBe("auto");
    expect(textarea.getAttribute("data-auto-resize")).toBe("5-8");
    getComputedStyle.mockRestore();
  });

  it("评论框可以从一行起高", () => {
    const getComputedStyle = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      paddingTop: "10px",
      paddingBottom: "10px",
      borderTopWidth: "1px",
      borderBottomWidth: "1px"
    });
    const { rerender } = render(<AutoResizeTextarea aria-label="评论" minRows={1} maxRows={6} value="一行" readOnly />);
    const textarea = screen.getByLabelText("评论");
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 42 });
    rerender(<AutoResizeTextarea aria-label="评论" minRows={1} maxRows={6} value="一行" readOnly />);
    expect(textarea.style.height).toBe("42px");
    expect(textarea.getAttribute("data-auto-resize")).toBe("1-6");
    getComputedStyle.mockRestore();
  });
});
