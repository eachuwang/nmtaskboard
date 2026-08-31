import crypto from "node:crypto";

const AUTHORITY_KEYS = new Set([
  "confirmationPromise",
  "apiKey",
  "token",
  "authorization",
  "password",
  "credential",
  "accessToken",
  "cookies"
]);

export function sessionError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function persistableDraft(draft) {
  if (!draft || typeof draft !== "object") return draft;
  const clone = {};
  for (const [key, value] of Object.entries(draft)) {
    if (AUTHORITY_KEYS.has(key)) continue;
    clone[key] = value;
  }
  return JSON.parse(JSON.stringify(clone));
}

export function persistableDrafts(value) {
  return (Array.isArray(value) ? value : []).map(persistableDraft);
}

function actorIdOf(context) {
  return context?.actor?.id;
}

function workspaceIdOf(context) {
  return context?.workspace?.id;
}

function nowIso() {
  return new Date().toISOString();
}

function emptySession(context) {
  return {
    id: crypto.randomUUID(),
    actorId: actorIdOf(context),
    workspaceId: workspaceIdOf(context),
    status: "active",
    summary: "",
    createdAt: nowIso(),
    archivedAt: null,
    messages: [],
    drafts: [],
    actionDrafts: [],
    assignmentDrafts: []
  };
}

function snapshot(session) {
  return {
    id: session.id,
    actorId: session.actorId,
    workspaceId: session.workspaceId,
    status: session.status,
    summary: typeof session.summary === "string" ? session.summary : "",
    createdAt: session.createdAt,
    archivedAt: session.archivedAt || null,
    messages: (session.messages || []).map((message) => ({
      id: message.id,
      seq: message.seq,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt
    })),
    drafts: persistableDrafts(session.drafts),
    actionDrafts: persistableDrafts(session.actionDrafts),
    assignmentDrafts: persistableDrafts(session.assignmentDrafts)
  };
}

function assertReadable(session, context) {
  if (!session || session.actorId !== actorIdOf(context)) {
    throw sessionError("AGENT_SESSION_NOT_FOUND", "Agent 会话不存在", 404);
  }
}

function archiveSession(session) {
  if (session.status === "active") {
    session.status = "archived";
    session.archivedAt = nowIso();
  }
  return session;
}

export function createMemoryAgentSessionStore() {
  const sessions = new Map();
  const locks = new Map();

  const withLock = (id, fn) => {
    const next = (locks.get(id) || Promise.resolve()).catch(() => {}).then(fn);
    locks.set(id, next);
    return next;
  };

  const archiveOtherWorkspaces = (context) => {
    const actorId = actorIdOf(context);
    const workspaceId = workspaceIdOf(context);
    for (const session of sessions.values()) {
      if (session.actorId === actorId && session.status === "active" && session.workspaceId !== workspaceId) {
        archiveSession(session);
      }
    }
  };

  return {
    async getOrCreate(context) {
      archiveOtherWorkspaces(context);
      const existing = [...sessions.values()].find((session) => (
        session.actorId === actorIdOf(context)
        && session.workspaceId === workspaceIdOf(context)
        && session.status === "active"
      ));
      if (existing) return { session: snapshot(existing), created: false };
      const session = emptySession(context);
      sessions.set(session.id, session);
      return { session: snapshot(session), created: true };
    },

    async getBound(context, id) {
      return withLock(id, async () => {
        const session = sessions.get(id);
        assertReadable(session, context);
        if (session.status !== "active") {
          throw sessionError("AGENT_SESSION_ARCHIVED", "Agent 会话已结束，请新建会话", 409);
        }
        if (session.workspaceId !== workspaceIdOf(context)) {
          archiveSession(session);
          throw sessionError("AGENT_SESSION_CONTEXT_CHANGED", "空间已经切换，原 Agent 会话已结束", 409);
        }
        return snapshot(session);
      });
    },

    async archive(context, id) {
      const session = sessions.get(id);
      assertReadable(session, context);
      archiveSession(session);
    },

    async save(context, session) {
      return withLock(session.id, async () => {
        const current = sessions.get(session.id);
        assertReadable(current, context);
        if (current.workspaceId !== workspaceIdOf(context) || current.workspaceId !== session.workspaceId) {
          archiveSession(current);
          throw sessionError("AGENT_SESSION_CONTEXT_CHANGED", "空间已经切换，原 Agent 会话已结束", 409);
        }
        current.summary = typeof session.summary === "string" ? session.summary : current.summary;
        current.status = session.status;
        current.archivedAt = session.archivedAt || current.archivedAt;
        current.drafts = persistableDrafts(session.drafts).slice(-6);
        current.actionDrafts = persistableDrafts(session.actionDrafts).slice(-6);
        current.assignmentDrafts = persistableDrafts(session.assignmentDrafts).slice(-6);
        return snapshot(current);
      });
    },

    async appendMessages(context, id, items) {
      return withLock(id, async () => {
        const session = sessions.get(id);
        assertReadable(session, context);
        if (session.status !== "active") {
          throw sessionError("AGENT_SESSION_ARCHIVED", "Agent 会话已结束，请新建会话", 409);
        }
        if (session.workspaceId !== workspaceIdOf(context)) {
          archiveSession(session);
          throw sessionError("AGENT_SESSION_CONTEXT_CHANGED", "空间已经切换，原 Agent 会话已结束", 409);
        }
        let seq = session.messages.reduce((max, message) => Math.max(max, message.seq || 0), 0);
        for (const item of items) {
          seq += 1;
          session.messages.push({
            id: crypto.randomUUID(),
            seq,
            role: item.role,
            content: item.content,
            createdAt: nowIso()
          });
        }
        return snapshot(session);
      });
    }
  };
}
