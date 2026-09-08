import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDisplayNameInput } from "../lib/auth.js";

test("显示名称校验：去除首尾空格，1–40 字符，禁止纯空白与换行", () => {
  assert.equal(normalizeDisplayNameInput("  张三  "), "张三");
  assert.equal(normalizeDisplayNameInput("A".repeat(40)), "A".repeat(40));
  // 允许同名（不查重），允许中英文与符号
  assert.equal(normalizeDisplayNameInput("Joe · 牛马"), "Joe · 牛马");

  for (const invalid of ["", "   ", "A".repeat(41), "含\n换行", "含\r回车", null, undefined, 42]) {
    assert.throws(() => normalizeDisplayNameInput(invalid), (error) => error.code === "DISPLAY_NAME_INVALID" && error.statusCode === 400);
  }
});
