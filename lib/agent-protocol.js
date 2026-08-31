export const RUN_REASONS = Object.freeze({
  answered: "answered",
  awaiting_confirmation: "awaiting_confirmation",
  limit: "limit",
  cancelled: "cancelled",
  failed: "failed"
});

export const RUN_PHASES = Object.freeze({
  understand: "understand",
  read: "read",
  preview: "preview",
  answer: "answer"
});

const TERMINAL_EVENTS = new Set(["done", "error", "cancelled"]);

export function createRunEmitter({ send, signal } = {}) {
  const runId = globalThis.crypto.randomUUID();
  const turnId = globalThis.crypto.randomUUID();
  let seq = 0;
  let ended = false;

  const emit = (event, data = {}) => {
    if (ended || signal?.aborted) return false;
    seq += 1;
    send(event, { runId, turnId, seq, ...data });
    if (TERMINAL_EVENTS.has(event)) ended = true;
    return true;
  };

  signal?.addEventListener?.("abort", () => { ended = true; }, { once: true });

  return {
    runId,
    turnId,
    get closed() { return ended || Boolean(signal?.aborted); },
    start() { emit("run", { status: "started" }); },
    phase(phase) { emit("phase", { phase }); },
    intent(text) { emit("intent", { text }); },
    toolStart(name, args) {
      const toolCallId = globalThis.crypto.randomUUID();
      emit("tool", { toolCallId, name, status: "running", arguments: args || {} });
      return toolCallId;
    },
    toolComplete(toolCallId, name) { emit("tool", { toolCallId, name, status: "complete" }); },
    result(toolCallId, tool, data) { emit("result", { toolCallId, tool, data }); },
    draft(event, draft, toolCallId) { emit(event, { toolCallId, draft }); },
    delta(text) { emit("delta", { text }); },
    done(reason, extra = {}) { emit("done", { reason, ...extra }); },
    error(message, code) { emit("error", { message, code }); },
    cancelled() { emit("cancelled", { reason: RUN_REASONS.cancelled }); }
  };
}

export function createEventGuard() {
  const lastSeq = new Map();
  const closed = new Set();
  return (event, data) => {
    if (!data || typeof data.runId !== "string" || typeof data.turnId !== "string" || !Number.isInteger(data.seq) || data.seq < 1) {
      return false;
    }
    if (closed.has(data.runId)) return false;
    const previous = lastSeq.get(data.runId) || 0;
    if (data.seq !== previous + 1) return false;
    lastSeq.set(data.runId, data.seq);
    if (TERMINAL_EVENTS.has(event)) closed.add(data.runId);
    return true;
  };
}

export function isTruncatedCompletion(result) {
  const reason = result?.raw?.choices?.[0]?.finish_reason;
  return reason === "length" || reason === "max_tokens";
}

export function stampDraftOrigin(draft, run, toolCallId) {
  draft.origin = { runId: run.runId, turnId: run.turnId, toolCallId };
  return draft;
}

export function originAuditSummary(draft, extra = {}) {
  const origin = draft?.origin && typeof draft.origin === "object" ? draft.origin : {};
  const summary = { ...extra };
  for (const key of ["runId", "turnId", "toolCallId"]) {
    if (typeof origin[key] === "string" && origin[key]) summary[key] = origin[key];
  }
  return summary;
}
