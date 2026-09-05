import { REPORT_TYPES } from "../report.js";
import { createReportEvidence, filterReportEvidence } from "../report-service.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function diffLines(fromText, toText) {
  const fromLines = (fromText || "").split("\n");
  const toLines = (toText || "").split("\n");
  const m = fromLines.length;
  const n = toLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = fromLines[i] === toLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < m && j < n) {
    if (fromLines[i] === toLines[j]) { lines.push({ type: "same", text: fromLines[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ type: "del", text: fromLines[i] }); i++; removed++; }
    else { lines.push({ type: "add", text: toLines[j] }); j++; added++; }
  }
  while (i < m) { lines.push({ type: "del", text: fromLines[i] }); i++; removed++; }
  while (j < n) { lines.push({ type: "add", text: toLines[j] }); j++; added++; }
  return { added, removed, lines };
}

export function register(app, ctx) {
  const requireAdapter = () => {
    if (!ctx.persistence?.reportVersions) throw Object.assign(new Error("报告版本存储未启用"), { statusCode: 501 });
  };
  const memberAuthorId = () => null;
  const canReadVersion = (context, version) => Boolean(version)
    && (!memberAuthorId(context) || version.authorIdentityId === context.actor.id);

  app.post("/api/report/versions", asyncH(async (req, res) => {
    requireAdapter();
    const body = req.body || {};
    const reportType = typeof body.reportType === "string" && REPORT_TYPES.includes(body.reportType) ? body.reportType : "weekly";
    let rangeStart = null;
    let rangeEnd = null;
    if (reportType !== "handover") {
      if (!DATE_RE.test(body.range?.start || "") || !DATE_RE.test(body.range?.end || "")) {
        throw Object.assign(new Error("日期范围不合法"), { statusCode: 400 });
      }
      rangeStart = body.range.start;
      rangeEnd = body.range.end;
      if (rangeStart > rangeEnd) throw Object.assign(new Error("开始日期不能晚于结束日期"), { statusCode: 400 });
    }
    const draftText = typeof body.draftText === "string" ? body.draftText : "";
    if (!draftText.trim()) throw Object.assign(new Error("报告内容不能为空"), { statusCode: 400 });
    if (draftText.length > 20000) throw Object.assign(new Error("报告内容过长（最多 20000 字）"), { statusCode: 400 });
    const generated = await createReportEvidence(ctx, req.context, {
      type: reportType, start: rangeStart, end: rangeEnd, includeCompleted: Boolean(body.includeCompleted),
      scope: body.scope === "workspace" || body.scope === "personal" ? body.scope : undefined
    });
    const evidenceSummary = filterReportEvidence(generated.evidence, body.excludedTaskIds, body.includeNextWeek !== false);
    const source = ["deterministic", "ai", "manual"].includes(body.source) ? body.source : "manual";
    const subject = generated.subject;
    const version = await ctx.persistence.reportVersions.save(req.context, {
      reportType, rangeStart, rangeEnd, subject,
      evidenceSummary,
      draftText, model: typeof body.model === "string" ? body.model : null, source
    });
    res.status(201).json({ version });
  }));

  app.get("/api/report/versions", asyncH(async (req, res) => {
    requireAdapter();
    const versions = await ctx.persistence.reportVersions.list(req.context, {
      reportType: typeof req.query.reportType === "string" && REPORT_TYPES.includes(req.query.reportType) ? req.query.reportType : undefined,
      rangeStart: DATE_RE.test(req.query.rangeStart || "") ? req.query.rangeStart : undefined,
      rangeEnd: DATE_RE.test(req.query.rangeEnd || "") ? req.query.rangeEnd : undefined,
      authorIdentityId: memberAuthorId(req.context) || undefined
    });
    res.json({ versions });
  }));

  app.get("/api/report/versions/:id", asyncH(async (req, res) => {
    requireAdapter();
    const version = await ctx.persistence.reportVersions.read(req.context, req.params.id);
    if (!canReadVersion(req.context, version)) throw Object.assign(new Error("报告版本不存在或无权访问"), { statusCode: 404 });
    res.json({ version });
  }));

  app.get("/api/report/versions/:fromId/diff/:toId", asyncH(async (req, res) => {
    requireAdapter();
    const from = await ctx.persistence.reportVersions.read(req.context, req.params.fromId);
    const to = await ctx.persistence.reportVersions.read(req.context, req.params.toId);
    if (!canReadVersion(req.context, from) || !canReadVersion(req.context, to)) throw Object.assign(new Error("报告版本不存在或无权访问"), { statusCode: 404 });
    res.json({ from: metaOf(from), to: metaOf(to), diff: diffLines(from.draftText, to.draftText) });
  }));

  app.post("/api/report/versions/:id/restore", asyncH(async (req, res) => {
    requireAdapter();
    const version = await ctx.persistence.reportVersions.read(req.context, req.params.id);
    if (!canReadVersion(req.context, version)) throw Object.assign(new Error("报告版本不存在或无权访问"), { statusCode: 404 });
    res.json({ version: { id: version.id, reportType: version.reportType, rangeStart: version.rangeStart, rangeEnd: version.rangeEnd, subject: version.subject, source: version.source, authorDisplayName: version.authorDisplayName, createdAt: version.createdAt, draftText: version.draftText, evidenceSummary: version.evidenceSummary } });
  }));
}

function metaOf(version) {
  const { draftText, evidenceSummary, ...meta } = version;
  return meta;
}
