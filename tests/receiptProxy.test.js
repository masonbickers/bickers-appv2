import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { createReceiptProxy, receiptUpdateRequired } from "../server/receiptProxy.js";
function response() { return { statusCode: 200, headers: {}, chunks: [], status(code) { this.statusCode = code; return this; }, json(body) { this.jsonBody = body; return this; }, set(name, value) { this.headers[name.toLowerCase()] = value; return this; }, write(chunk) { this.chunks.push(Buffer.from(chunk)); this.headersSent = true; return true; }, end() { this.ended = true; } }; }
const request = (path = "/", method = "GET") => ({ path, method, headers: { authorization: "Bearer caller-token" }, query: { companyId: "company" }, body: { operationId: "stable", action: "receipt.submit" } });

test("proxy preserves bearer, operation payload, status and streamed original bytes", async () => {
  let sent; const bytes = new Uint8Array([0, 255, 10, 20]);
  const proxy = createReceiptProxy({ origin: "https://booking.example", production: true, fetchImpl: async (url, options) => { sent = { url, options }; return new Response(bytes, { status: 206, headers: { "Content-Type": "application/pdf" } }); } });
  const res = response(); await proxy(request("/evidence/receipt-1"), res);
  assert.equal(sent.url, "https://booking.example/api/receipts/v2/evidence/receipt-1?companyId=company"); assert.equal(sent.options.headers.Authorization, "Bearer caller-token"); assert.equal(sent.options.redirect, "error");
  assert.equal(res.statusCode, 206); assert.deepEqual(Buffer.concat(res.chunks), Buffer.from(bytes)); assert.equal(res.headers["cache-control"], "private, no-store");
});
test("proxy forwards command without introducing financial authority", async () => {
  let body; const proxy = createReceiptProxy({ origin: "https://booking.example", fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return Response.json({ error: "Denied", code: "access_denied" }, { status: 403 }); } });
  const req = request("/command", "POST"); const res = response(); await proxy(req, res); assert.deepEqual(body, req.body); assert.equal(res.statusCode, 403);
});
test("proxy cannot target arbitrary paths, missing auth or insecure production origin", async () => {
  let fetched = 0; const proxy = createReceiptProxy({ origin: "https://booking.example", fetchImpl: async () => { fetched++; } });
  for (const path of ["/../../admin", "//evil.example", "/evidence/a/b", "/users"]) { const res = response(); await proxy(request(path), res); assert.equal(res.statusCode, 404); }
  const req = request(); req.headers = {}; const unauth = response(); await proxy(req, unauth); assert.equal(unauth.statusCode, 401);
  const unsafe = response(); await createReceiptProxy({ origin: "http://booking.example", production: true })(request(), unsafe); assert.equal(unsafe.statusCode, 503); assert.equal(fetched, 0);
});
test("uncertain upstream errors never acknowledge a successful receipt submission", async () => {
  const res = response(); await createReceiptProxy({ origin: "https://booking.example", fetchImpl: async () => { throw new Error("private secret"); } })(request("/command", "POST"), res);
  assert.equal(res.statusCode, 502); assert.equal(res.jsonBody.ok, undefined); assert.doesNotMatch(JSON.stringify(res.jsonBody), /private secret/);
});
test("retired receipt endpoints return update_required without mutation", () => { const res = response(); receiptUpdateRequired(request(), res); assert.equal(res.statusCode, 426); assert.equal(res.jsonBody.code, "update_required"); });
