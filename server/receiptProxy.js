// Next performs identity, tenant, role and operation checks. Only fixed receipt
// routes and the caller's Firebase bearer token are forwarded from Render.
export function createReceiptProxy({ origin = process.env.RECEIPTS_WEB_ORIGIN, fetchImpl = globalThis.fetch, production = process.env.NODE_ENV === "production", timeoutMs = 45000 } = {}) {
  return async (req, res) => {
    const path = String(req.path || "/");
    const method = String(req.method || "GET");
    const allowed = method === "GET"
      ? /^\/(?:evidence\/[A-Za-z0-9_-]+|batches\/[A-Za-z0-9_-]+)?\/?$/.test(path)
      : method === "POST" && /^\/(command|extract|import-preview)\/?$/.test(path);
    if (!allowed) return res.status(404).json({ error: "Receipt route not found." });
    const authorization = req.get?.("authorization") || req.headers?.authorization;
    if (!/^Bearer \S+$/.test(authorization || "")) return res.status(401).json({ error: "Missing auth token." });
    let base;
    try {
      base = new URL(String(origin || ""));
      if (base.username || base.password || base.search || base.hash || !["https:", "http:"].includes(base.protocol) || (production && base.protocol !== "https:")) throw new Error();
    } catch { return res.status(503).json({ error: "The receipt service is not configured.", code: "receipt_service_not_configured" }); }
    const target = new URL(`${base.pathname.replace(/\/$/, "")}/api/receipts/v2${path === "/" ? "" : path}`, base.origin);
    for (const key of ["companyId", "format"]) if (typeof req.query?.[key] === "string") target.searchParams.set(key, req.query[key]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetchImpl(target.href, { method, redirect: "error", headers: { Authorization: authorization, "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(req.body || {}) } : {}), signal: controller.signal });
      res.set("Cache-Control", "private, no-store");
      for (const header of ["content-type", "content-disposition", "etag"]) {
        const value = upstream.headers.get(header);
        if (value) res.set(header, value);
      }
      res.status(upstream.status);
      if (!upstream.body) return res.end();
      for await (const chunk of upstream.body) {
        if (res.destroyed) { controller.abort(); break; }
        if (!res.write(chunk)) await new Promise((resolve) => { res.once("drain", resolve); res.once("close", resolve); });
      }
      res.end();
    } catch {
      if (!res.headersSent) res.status(502).json({ error: "The receipt service did not confirm the request. Retry with the same saved operation.", code: "receipt_upstream_unavailable" });
      else res.end();
    } finally { clearTimeout(timer); }
  };
}

export function receiptUpdateRequired(_req, res) {
  return res.status(426).json({ error: "Update the app to use company-card receipts.", code: "update_required" });
}
