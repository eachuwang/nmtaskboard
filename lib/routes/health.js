export function register(app) {
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });
}
