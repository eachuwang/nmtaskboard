import { afterEach, describe, expect, it } from "vitest";
import { toast } from "./toast.js";

afterEach(() => {
  document.querySelectorAll(".toast").forEach((element) => element.remove());
});

describe("toast", () => {
  it("does not render a toast when the message is empty", () => {
    toast("");

    expect(document.querySelector(".toast")).toBeNull();
  });

  it("renders a non-empty message", () => {
    toast("已保存");

    expect(document.querySelector(".toast")?.textContent).toBe("已保存");
  });
});
