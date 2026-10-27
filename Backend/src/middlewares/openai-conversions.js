"use strict";
const fs = require("fs");
const crypto = require("crypto");
const queueDir = process.env.OPENAI_CONVERSIONS_QUEUE || "/var/lib/criscom-conversions";
const keyPath = process.env.OPENAI_CONVERSIONS_KEY_FILE || "/run/secrets/openai-conversions-api-key";
const pixelId = "BkT9q87Fakfy6YWHW8mYso";
const endpoints = {
  "/api/ecommerce/solicitudes-servicio": "codigo",
  "/api/ecommerce/solicitudes-importacion": "nested",
  "/api/ecommerce/solicitudes-ensamble": "nested",
  "/api/community/subscribe": "success"
};
let running = false;
function eventFor(req, status, body) {
  const path = (req.originalUrl || req.url || "").split("?")[0].replace(/\/$/, "");
  const kind = endpoints[path];
  if (req.method !== "POST" || !kind || status < 200 || status >= 300 || !body || body.success === false) return null;
  const code = kind === "codigo" ? body.codigo : kind === "nested" ? body.data?.codigo_seguimiento : null;
  if (kind === "success" ? body.success !== true : !code) return null;
  let source = "https://criscomgroup.com.pe/";
  let oppref = req.get("x-criscom-oppref");
  if (typeof oppref !== "string" || oppref.length > 2048 || oppref.includes("{")) oppref = undefined;
  try {
    const url = new URL(req.get("referer") || source);
    if (["criscomgroup.com.pe", "www.criscomgroup.com.pe"].includes(url.hostname)) {
      source = "https://criscomgroup.com.pe" + url.pathname;
      oppref = oppref || url.searchParams.get("oppref") || url.searchParams.get("oa_click") || undefined;
    }
  } catch {}
  const id = code ? "criscom_" + crypto.createHash("sha256").update(path + ":" + code).digest("hex").slice(0, 40) : "criscom_" + crypto.randomUUID();
  return { id, type: "appointment_scheduled", timestamp_ms: Date.now(), source_url: source, action_source: "web", ...(oppref ? {oppref} : {}), data: {type: "customer_action"} };
}
function enqueue(event) {
  fs.mkdirSync(queueDir, {recursive: true, mode: 0o700});
  const file = queueDir + "/" + event.id + ".json";
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file + ".tmp", JSON.stringify({event, attempts:0, next:0}), {mode:0o600});
    fs.renameSync(file + ".tmp", file);
  }
}
async function flush() {
  if (running) return;
  running = true;
  try {
    if (!fs.existsSync(queueDir)) return;
    const key = fs.readFileSync(keyPath, "utf8").trim();
    if (!key) return;
    for (const name of fs.readdirSync(queueDir).filter(x => x.endsWith(".json")).slice(0,50)) {
      const file = queueDir + "/" + name;
      const item = JSON.parse(fs.readFileSync(file, "utf8"));
      if (item.next > Date.now()) continue;
      if (Date.now() - item.event.timestamp_ms > 6 * 86400000) {
        fs.renameSync(file, file + ".expired"); continue;
      }
      try {
        const response = await fetch("https://bzr.openai.com/v1/events?pid=" + pixelId, {
          method: "POST", headers: {"Authorization":"Bearer " + key, "Content-Type":"application/json", "User-Agent":"CRISCOM-Conversions/1.0"},
          body: JSON.stringify({validate_only:false, events:[item.event]}), signal:AbortSignal.timeout(12000)
        });
        await response.text();
        if (!response.ok) throw new Error("HTTP " + response.status);
        fs.unlinkSync(file);
        console.log("[openai-conversions] delivered", item.event.id);
      } catch(error) {
        item.attempts++;
        item.next = Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(item.attempts,8));
        fs.writeFileSync(file + ".tmp",JSON.stringify(item),{mode:0o600});
        fs.renameSync(file + ".tmp", file);
        console.warn("[openai-conversions] retry", item.event.id, error.message);
      }
    }
  } catch(error) { console.warn("[openai-conversions] queue unavailable:", error.code || error.name); }
  finally { running = false; }
}
function middleware(req,res,next) {
  const original = res.json;
  let recorded = false;
  res.json = function(body) {
    if (!recorded) {
      recorded = true;
      try {
        const event = eventFor(req,res.statusCode,body);
        if (event) {
          enqueue(event);
          body = {...body, measurement_event_id:event.id};
          setImmediate(flush);
        }
      } catch(error) { console.warn("[openai-conversions] enqueue failed:",error.code || error.name); }
    }
    return original.call(this,body);
  };
  next();
}
const timer = setInterval(flush,30000);
timer.unref();
module.exports = {middleware,eventFor,enqueue,flush};
