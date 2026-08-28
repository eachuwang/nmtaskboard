import crypto from "node:crypto";

export class OidcError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const base64url = (value) => Buffer.from(value).toString("base64url");

function validTenant(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value);
}

function validateConfig(config) {
  if (!validTenant(config?.tenantId || "")) throw new OidcError("ENTRA_CONFIG_INVALID", "Microsoft Entra 租户 ID 或域名无效");
  if (!/^[0-9a-f-]{30,40}$/i.test(config?.clientId || "")) throw new OidcError("ENTRA_CONFIG_INVALID", "Microsoft Entra 客户端 ID 无效");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config?.administratorSubject || "")) {
    throw new OidcError("ENTRA_CONFIG_INVALID", "系统管理员的 Microsoft Entra 对象 ID 无效");
  }
  try {
    const redirect = new URL(config.redirectUri);
    if (!/^https?:$/.test(redirect.protocol)) throw new Error();
    if (redirect.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(redirect.hostname)) throw new Error();
  } catch {
    throw new OidcError("ENTRA_CONFIG_INVALID", "Microsoft Entra 回调地址无效");
  }
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new OidcError("OIDC_TOKEN_INVALID", "身份令牌格式无效", 401);
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], "base64url")),
      claims: JSON.parse(Buffer.from(parts[1], "base64url")),
      signed: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2], "base64url")
    };
  } catch {
    throw new OidcError("OIDC_TOKEN_INVALID", "身份令牌无法解析", 401);
  }
}

async function responseJson(response, code, message) {
  if (!response.ok) throw new OidcError(code, `${message}（HTTP ${response.status}）`, 502);
  return response.json();
}

export function createEntraOidcAdapter({ repository, decryptSecret, fetchImpl = fetch, authorityBase = "https://login.microsoftonline.com", now = () => Date.now() }) {
  const metadataCache = new Map();
  const getConfiguration = async () => {
    const config = await repository.getAuthConfiguration();
    if (config.provider !== "entra") throw new OidcError("AUTH_PROVIDER_DISABLED", "当前实例未启用 Microsoft Entra ID", 409);
    validateConfig(config);
    return { ...config, clientSecret: decryptSecret(config.clientSecretEncrypted) };
  };
  const discovery = async (config, refresh = false) => {
    const key = config.tenantId;
    if (!refresh && metadataCache.has(key)) return metadataCache.get(key);
    const url = `${authorityBase.replace(/\/$/, "")}/${encodeURIComponent(config.tenantId)}/v2.0/.well-known/openid-configuration`;
    const metadata = await responseJson(await fetchImpl(url, { headers: { accept: "application/json" } }), "OIDC_DISCOVERY_FAILED", "无法读取 Microsoft Entra 配置");
    for (const field of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"]) {
      if (!metadata[field]) throw new OidcError("OIDC_DISCOVERY_FAILED", `Microsoft Entra 配置缺少 ${field}`, 502);
    }
    metadataCache.set(key, metadata);
    return metadata;
  };

  return {
    async testConnection(input) {
      validateConfig(input);
      const metadata = await discovery(input, true);
      await responseJson(await fetchImpl(metadata.jwks_uri, { headers: { accept: "application/json" } }), "OIDC_JWKS_FAILED", "无法读取 Microsoft Entra 签名密钥");
      return { ok: true, issuer: metadata.issuer };
    },
    async startLogin() {
      const config = await getConfiguration();
      const metadata = await discovery(config);
      const state = crypto.randomBytes(32).toString("base64url");
      const nonce = crypto.randomBytes(32).toString("base64url");
      const codeVerifier = crypto.randomBytes(48).toString("base64url");
      await repository.createOidcFlow({
        stateHash: digest(state), nonceHash: digest(nonce), codeVerifier,
        expiresAt: new Date(now() + 10 * 60 * 1000).toISOString()
      });
      const url = new URL(metadata.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: config.redirectUri,
        response_mode: "query",
        scope: "openid profile email",
        state,
        nonce,
        code_challenge: base64url(crypto.createHash("sha256").update(codeVerifier).digest()),
        code_challenge_method: "S256"
      });
      return url.toString();
    },
    async completeLogin({ state, code }) {
      if (!state || !code) throw new OidcError("OIDC_CALLBACK_INVALID", "Microsoft 登录回调缺少必要参数");
      const flow = await repository.consumeOidcFlow(digest(state));
      if (!flow) throw new OidcError("OIDC_STATE_INVALID", "登录状态无效或已使用", 401);
      if (new Date(flow.expiresAt).getTime() <= now()) throw new OidcError("OIDC_STATE_EXPIRED", "登录请求已过期，请重试", 401);
      const config = await getConfiguration();
      const metadata = await discovery(config);
      const tokenResponse = await fetchImpl(metadata.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          code_verifier: flow.codeVerifier
        })
      });
      const tokens = await responseJson(tokenResponse, "OIDC_TOKEN_EXCHANGE_FAILED", "Microsoft 登录令牌交换失败");
      const jwt = parseJwt(tokens.id_token);
      if (jwt.header.alg !== "RS256" || !jwt.header.kid) throw new OidcError("OIDC_TOKEN_INVALID", "身份令牌签名算法无效", 401);
      const jwks = await responseJson(await fetchImpl(metadata.jwks_uri, { headers: { accept: "application/json" } }), "OIDC_JWKS_FAILED", "无法读取 Microsoft Entra 签名密钥");
      const jwk = jwks.keys?.find((key) => key.kid === jwt.header.kid && key.kty === "RSA");
      if (!jwk) throw new OidcError("OIDC_SIGNING_KEY_UNKNOWN", "找不到身份令牌签名密钥", 401);
      const verified = crypto.verify("RSA-SHA256", Buffer.from(jwt.signed), crypto.createPublicKey({ key: jwk, format: "jwk" }), jwt.signature);
      if (!verified) throw new OidcError("OIDC_SIGNATURE_INVALID", "身份令牌签名校验失败", 401);
      const currentSeconds = Math.floor(now() / 1000);
      if (jwt.claims.iss !== metadata.issuer) throw new OidcError("OIDC_ISSUER_INVALID", "身份令牌发行者不受信任", 401);
      if (jwt.claims.aud !== config.clientId) throw new OidcError("OIDC_AUDIENCE_INVALID", "身份令牌受众不匹配", 401);
      if (!jwt.claims.exp || jwt.claims.exp <= currentSeconds || (jwt.claims.nbf && jwt.claims.nbf > currentSeconds + 60)) {
        throw new OidcError("OIDC_TOKEN_EXPIRED", "身份令牌已过期或尚未生效", 401);
      }
      if (jwt.claims.iat && jwt.claims.iat > currentSeconds + 60) throw new OidcError("OIDC_TOKEN_INVALID", "身份令牌签发时间无效", 401);
      if (digest(jwt.claims.nonce || "") !== flow.nonceHash) throw new OidcError("OIDC_NONCE_INVALID", "身份令牌 nonce 不匹配", 401);
      if (jwt.claims.tid !== config.tenantId) throw new OidcError("OIDC_TENANT_DENIED", "该 Microsoft 租户未获准访问", 403);
      const subject = jwt.claims.oid || jwt.claims.sub;
      if (!subject) throw new OidcError("OIDC_SUBJECT_MISSING", "身份令牌缺少用户标识", 401);
      return repository.bindExternalIdentity({
        provider: "entra", subject, tenantId: jwt.claims.tid,
        email: jwt.claims.preferred_username || jwt.claims.email || null,
        displayName: jwt.claims.name || jwt.claims.preferred_username || "Microsoft 用户"
      });
    }
  };
}
