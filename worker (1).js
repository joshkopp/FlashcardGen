// Cloudflare Worker: lets your pages use Cloudflare's free built-in AI (Workers AI).
// No external API key needed. Setup in the Cloudflare dashboard (Worker > Settings):
//   Bindings > Add > Workers AI, variable name: AI
//   Variables and Secrets:
//     ACCESS_CODE      (secret)  a passphrase only you know; pages must send it
//     ALLOWED_ORIGINS  (text)    e.g. https://joshkopp.github.io,https://joshkoppanalil.com
//     MODEL            (text, optional) defaults to @cf/meta/llama-3.1-8b-instruct
const MAX_PROMPT = 12000, MAX_SYSTEM = 4000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin);
    const cors = {
      "access-control-allow-origin": allowed.length ? (originOk ? origin : allowed[0]) : "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-access-code",
      "vary": "origin"
    };
    const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return out({ error: "POST only." }, 405);
    if (!originOk) return out({ error: "This site isn't allowed to use this server." }, 403);
    if (!env.ACCESS_CODE) return out({ error: "Server setup incomplete: add an ACCESS_CODE secret." }, 500);
    if (request.headers.get("x-access-code") !== env.ACCESS_CODE) return out({ error: "Wrong or missing access code." }, 401);
    if (!env.AI) return out({ error: "Server setup incomplete: add a Workers AI binding named AI." }, 500);

    let body;
    try { body = await request.json(); } catch { return out({ error: "Send JSON." }, 400); }
    const prompt = String(body.prompt || ""), system = String(body.system || "");
    if (!prompt.trim()) return out({ error: "Empty prompt." }, 400);
    if (prompt.length > MAX_PROMPT || system.length > MAX_SYSTEM) return out({ error: "Request too large." }, 413);

    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    let res;
    try {
      res = await env.AI.run(env.MODEL || "@cf/meta/llama-3.1-8b-instruct", {
        messages, max_tokens: Math.min(Number(body.maxTokens) || 900, 2048), temperature: 0.2 });
    } catch (e) {
      const m = String((e && e.message) || e), quota = /free allocation|neurons/i.test(m);
      return out({ error: quota ? "Today's free AI allowance is used up. It resets at midnight UTC." : "AI error: " + m }, quota ? 429 : 502);
    }
    let text = typeof res === "string" ? res : (res && (res.response ?? (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content))) ?? "";
    if (typeof text !== "string") text = JSON.stringify(text);
    return out({ text });
  }
};
