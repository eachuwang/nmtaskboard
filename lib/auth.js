import crypto from "node:crypto";
import { promisify } from "node:util";
import { DEFAULT_LOCAL_ACTOR_ID, DEFAULT_PERSONAL_WORKSPACE_ID } from "./personal-space.js";

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = "nmtaskboard_session";

export class AuthError extends Error {
  constructor(code, message, statusCode = 401) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizedLogin(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeEqual(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltText, digestText] = String(encoded || "").split(":");
  if (algorithm !== "scrypt" || !saltText || !digestText) return false;
  const expected = Buffer.from(digestText, "base64");
  const actual = await scrypt(password, Buffer.from(saltText, "base64"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function sessionContext(identity) {
  const isMigratedLocal = identity.id === DEFAULT_LOCAL_ACTOR_ID;
  return Object.freeze({
    actor: Object.freeze({
      id: identity.id,
      displayName: identity.displayName,
      isSystemAdmin: identity.isSystemAdmin === true
    }),
    workspace: Object.freeze({
      id: isMigratedLocal ? DEFAULT_PERSONAL_WORKSPACE_ID : `personal-${identity.id}`,
      type: "personal"
    })
  });
}

export function createAuthService({ repository, bootstrapToken, sessionTtlMs = 12 * 60 * 60 * 1000, secureCookies = false }) {
  if (!repository) throw new Error("认证服务缺少持久化 Adapter");
  const cookie = (value, maxAge = 0) => [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secureCookies ? "Secure" : "",
    maxAge ? `Max-Age=${Math.floor(maxAge / 1000)}` : "Max-Age=0"
  ].filter(Boolean).join("; ");

  async function authenticate(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) throw new AuthError("UNAUTHENTICATED", "请先登录");
    const session = await repository.findSession(crypto.createHash("sha256").update(token).digest("hex"));
    if (!session || session.revokedAt) throw new AuthError("UNAUTHENTICATED", "会话无效，请重新登录");
    if (new Date(session.expiresAt).getTime() <= Date.now()) throw new AuthError("SESSION_EXPIRED", "会话已过期，请重新登录");
    if (session.identity.disabledAt) throw new AuthError("ACCOUNT_DISABLED", "账号已停用，请联系系统管理员", 403);
    return sessionContext(session.identity);
  }

  return {
    async bootstrapStatus() {
      return { completed: await repository.isBootstrapComplete(), configured: Boolean(bootstrapToken) };
    },
    async bootstrap(input, suppliedToken) {
      if (!bootstrapToken) throw new AuthError("BOOTSTRAP_NOT_CONFIGURED", "部署未配置初始管理员引导令牌", 503);
      if (!safeEqual(suppliedToken, bootstrapToken)) throw new AuthError("BOOTSTRAP_FORBIDDEN", "初始管理员引导令牌无效", 403);
      const login = normalizedLogin(input.login);
      const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 50) : "";
      if (!/^[a-z0-9._@-]{3,100}$/.test(login)) throw new AuthError("INVALID_ACCOUNT", "登录名格式无效", 400);
      if (!displayName) throw new AuthError("INVALID_ACCOUNT", "显示名称不能为空", 400);
      if (typeof input.password !== "string" || input.password.length < 12) {
        throw new AuthError("WEAK_PASSWORD", "密码至少需要 12 个字符", 400);
      }
      return repository.bootstrapInitialAdmin({ login, displayName, passwordHash: await hashPassword(input.password) });
    },
    async login(input) {
      const identity = await repository.findIdentityByLogin(normalizedLogin(input.login));
      if (!identity || !await verifyPassword(input.password || "", identity.passwordHash)) {
        throw new AuthError("INVALID_CREDENTIALS", "登录名或密码错误");
      }
      if (identity.disabledAt) throw new AuthError("ACCOUNT_DISABLED", "账号已停用，请联系系统管理员", 403);
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
      await repository.createSession({
        tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        identityId: identity.id,
        expiresAt
      });
      return { identity, expiresAt, cookie: cookie(token, sessionTtlMs) };
    },
    authenticate,
    async logout(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (token) await repository.revokeSession(crypto.createHash("sha256").update(token).digest("hex"));
      return cookie("");
    }
  };
}

export function registerAuthRoutes(app, auth) {
  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  app.get("/api/auth/bootstrap/status", asyncH(async (req, res) => res.json(await auth.bootstrapStatus())));
  app.post("/api/auth/bootstrap", asyncH(async (req, res) => {
    const identity = await auth.bootstrap(req.body || {}, req.headers["x-bootstrap-token"]);
    res.status(201).json({ identity: publicIdentity(identity) });
  }));
  app.post("/api/auth/login", asyncH(async (req, res) => {
    const result = await auth.login(req.body || {});
    res.setHeader("set-cookie", result.cookie);
    res.json({ identity: publicIdentity(result.identity), expiresAt: result.expiresAt });
  }));
  app.post("/api/auth/logout", asyncH(async (req, res) => {
    res.setHeader("set-cookie", await auth.logout(req));
    res.status(204).end();
  }));
  app.get("/api/auth/session", (req, res) => res.json({ actor: req.context.actor, workspace: req.context.workspace }));
}

function publicIdentity(identity) {
  return {
    id: identity.id,
    login: identity.login,
    displayName: identity.displayName,
    isSystemAdmin: identity.isSystemAdmin === true
  };
}

export function attachSessionContext(auth) {
  const publicPaths = new Set(["/api/health", "/api/auth/bootstrap", "/api/auth/bootstrap/status", "/api/auth/login"]);
  return async (req, res, next) => {
    if (!req.path.startsWith("/api/") || publicPaths.has(req.path)) return next();
    try {
      req.context = await auth.authenticate(req);
      next();
    } catch (error) {
      next(error);
    }
  };
}
