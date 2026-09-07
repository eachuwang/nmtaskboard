import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import pkg from "../../../package.json";
import ChangelogView from "./ChangelogView.jsx";
import { RELEASES } from "./releases.js";

describe("ChangelogView", () => {
  it("渲染当前版本徽章与全部版本条目", () => {
    render(<ChangelogView />);
    expect(screen.getByText(`当前版本 v${pkg.version}`)).toBeInTheDocument();
    for (const release of RELEASES) {
      expect(screen.getByRole("region", { name: `版本 ${release.version}` })).toBeInTheDocument();
    }
    const sectionTitles = [...new Set(RELEASES.flatMap((release) => release.sections.map((section) => section.title)))];
    for (const title of sectionTitles) {
      expect(screen.getAllByText(title, { selector: "span" }).length).toBeGreaterThan(0);
    }
  });
});
