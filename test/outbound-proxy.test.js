import test from "node:test";
import assert from "node:assert/strict";
import { outboundDispatcher } from "../lib/outbound-http.js";

test("未配置代理时返回 undefined（保持直连）", () => {
  assert.equal(outboundDispatcher({}), undefined);
});

test("配置代理后返回 dispatcher，大小写环境变量均可", () => {
  assert.ok(outboundDispatcher({ HTTP_PROXY: "http://proxy.internal:80" }));
  assert.ok(outboundDispatcher({ http_proxy: "http://proxy.internal:80" }));
  assert.ok(outboundDispatcher({ HTTPS_PROXY: "http://proxy.internal:80", NO_PROXY: "localhost,127.0.0.1" }));
});

test("相同代理配置复用同一 dispatcher 实例", () => {
  const env = { HTTP_PROXY: "http://proxy.internal:80" };
  assert.equal(outboundDispatcher(env), outboundDispatcher(env));
});
