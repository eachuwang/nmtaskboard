// 出站请求（LLM/模型拉取/Git 平台/S3）统一走这里。
// 背景：Node 内置 fetch（undici）默认不读取 http_proxy/https_proxy 环境变量，
// 在无公网直连、只能经代理出网的服务器上，所有外呼请求都会直连超时。
// 配置了代理时挂 EnvHttpProxyAgent（支持 NO_PROXY 排除内网地址）；
// 未配置代理时行为与原生 fetch 完全一致。
import { EnvHttpProxyAgent } from "undici";

let cachedKey = "";
let cachedAgent;

export function outboundDispatcher(env = process.env) {
  const httpProxy = env.HTTP_PROXY || env.http_proxy || "";
  const httpsProxy = env.HTTPS_PROXY || env.https_proxy || "";
  if (!httpProxy && !httpsProxy) return undefined;
  const noProxy = env.NO_PROXY || env.no_proxy || "";
  const key = `${httpProxy}|${httpsProxy}|${noProxy}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cachedAgent = new EnvHttpProxyAgent({
      httpProxy: httpProxy || undefined,
      httpsProxy: httpsProxy || undefined,
      noProxy
    });
  }
  return cachedAgent;
}

export function outboundFetch(url, init = {}) {
  const dispatcher = outboundDispatcher();
  return dispatcher ? fetch(url, { ...init, dispatcher }) : fetch(url, init);
}
