import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import markdown from "../../../CHANGELOG.md?raw";
import pkg from "../../../package.json";
import ChangelogView from "./ChangelogView.jsx";
import { RELEASES } from "./releases.js";
afterEach(cleanup);

describe("ChangelogView", () => {
  it("待发布与当前版本分开展示，目录链接到每个版本", () => {
    render(<ChangelogView />);
    expect(screen.getByText(`当前版本 v${pkg.version}`)).toBeInTheDocument();
    if (RELEASES.some((release) => release.version === "unreleased")) expect(screen.getByText("开发中 · 尚未发布")).toBeInTheDocument();
    else expect(screen.queryByText("开发中 · 尚未发布")).not.toBeInTheDocument();
    for (const release of RELEASES) {
      const label = release.version === "unreleased" ? "待发布" : `版本 ${release.version}`;
      const region = screen.getByRole("region", { name: label });
      expect(region).toHaveAttribute("id", `release-${release.version}`);
      expect(within(region).getByRole("heading", { name: release.title })).toBeInTheDocument();
    }
  });
  it("Markdown 与应用内日志保持同一标题、说明和条目", () => {
    expect(markdown.split("\n").filter((line) => line.startsWith("- "))).toEqual(
      RELEASES.flatMap((release) => release.sections.flatMap((section) => section.items.map((item) => `- ${item}`)))
    );
    for (const release of RELEASES) {
      expect(markdown).toContain(release.title);
      expect(markdown).toContain(release.summary);
      for (const section of release.sections) for (const item of section.items) expect(markdown).toContain(`- ${item}`);
    }
  });
});
