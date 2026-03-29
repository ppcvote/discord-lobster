// utils.js — Shared utilities for all lobster scripts
// Zero npm dependencies: pure Node.js https module

const fs = require("fs");
const https = require("https");
const path = require("path");
const config = require("./config");

// Ensure data and log directories exist
fs.mkdirSync(config.DATA_DIR, { recursive: true });
fs.mkdirSync(config.LOG_DIR, { recursive: true });

function log(prefix, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `[${ts}] ${msg}\n`;
  const logFile = path.join(config.LOG_DIR, `${prefix}.log`);
  try { fs.appendFileSync(logFile, line); } catch {}
  console.log(line.trim());
}

function discordApi(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "discord.com",
      path: `/api/v10${apiPath}`,
      method,
      headers: {
        Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function geminiGenerate(prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 400,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${config.GEMINI_API_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(d);
          const text = parsed.candidates?.[0]?.content?.parts
            ?.filter((p) => !p.thought)
            .map((p) => p.text)
            .join("") || "";
          resolve(text.trim());
        } catch { reject(new Error("Gemini parse error")); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function postWebhook(webhookUrl, content) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const payload = JSON.stringify({
      content,
      username: config.BOT_NAME,
      avatar_url: config.BOT_AVATAR_URL,
    });
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function loadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Strip @everyone and @here for safety
function sanitize(text) {
  return text.replace(/@everyone/g, "").replace(/@here/g, "");
}

module.exports = {
  log, discordApi, geminiGenerate, postWebhook,
  loadJson, saveJson, sleep, sanitize,
};
