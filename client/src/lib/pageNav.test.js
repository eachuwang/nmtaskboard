import { describe, expect, it } from "vitest";
import { APP_PAGES } from "./appRoute.js";
import { PAGE_NAV, TAB_OPEN_PAGES, WORKSPACE_PAGES } from "../shell/pageNav.js";

describe("页面导航配置一致性", () => {
  it("侧边栏每个页面都有导航元信息与有效图标名", () => {
    for (const id of WORKSPACE_PAGES) {
      expect(PAGE_NAV[id], `WORKSPACE_PAGES.${id} 缺少 PAGE_NAV 条目`).toBeTruthy();
      expect(PAGE_NAV[id].icon.length, `PAGE_NAV.${id}.icon 不能为空`).toBeGreaterThan(0);
      expect(PAGE_NAV[id].label.length, `PAGE_NAV.${id}.label 不能为空`).toBeGreaterThan(0);
    }
  });

  it("可路由页面均被路由表与标签页机制覆盖", () => {
    for (const id of WORKSPACE_PAGES) {
      expect(APP_PAGES, `APP_PAGES 缺少 ${id}`).toContain(id);
      expect(TAB_OPEN_PAGES, `TAB_OPEN_PAGES 缺少 ${id}`).toContain(id);
    }
    // 反向：路由表中的页面若带导航元信息，必须存在
    for (const id of APP_PAGES.filter((page) => page !== "my-tasks")) {
      expect(PAGE_NAV[id], `APP_PAGES.${id} 缺少 PAGE_NAV 条目`).toBeTruthy();
    }
  });
});
