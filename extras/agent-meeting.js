#!/usr/bin/env node
// agent-meeting.js — Multi-agent standup meeting in Discord
//
// 4 AI agents hold a daily meeting with different avatars and personalities.
// Reads community data (member count, recent topics) and generates
// a natural conversation. Posts via webhook with per-agent avatars.
//
// Cron: once daily (e.g., 09:00)
// Requires: GEMINI_API_KEY, DISCORD_BOT_TOKEN, GUILD_ID, MEETING_WEBHOOK_URL in .env

const fs = require("fs");
const https = require("https");
const path = require("path");

// --- Config from .env ---
const ENV_FILE = path.join(__dirname, "..", ".env");
try {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const WEBHOOK_URL = process.env.MEETING_WEBHOOK_URL || process.env.GENERAL_WEBHOOK_URL;
const GENERAL_CHANNEL = process.env.GENERAL_CHANNEL_ID;
const LOG_DIR = path.join(__dirname, "..", "logs");
const DRY_RUN = process.argv.includes("--dry-run");

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `[${ts}] ${msg}\n`;
  try { fs.appendFileSync(path.join(LOG_DIR, "agent-meeting.log"), line); } catch {}
  console.log(line.trim());
}

function request(method, hostname, reqPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: reqPath, method, headers }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Customize these for your community ──
const AGENTS = [
  { id: "CEO",        name: "CEO 🦞",        avatar: "", personality: "Boss with humor, opens and closes meetings" },
  { id: "Security",   name: "Security 🔴",    avatar: "", personality: "Cold, technical, direct" },
  { id: "Social",     name: "Social 🟢",      avatar: "", personality: "Bubbly, gossips about community members" },
  { id: "Finance",    name: "Finance 🟡",      avatar: "", personality: "Steady, analytical, talks about money and markets" },
];

async function getDiscordContext() {
  if (!BOT_TOKEN || !GUILD_ID) return "No Discord data available.";

  const lines = ["## Community Status"];

  try {
    const guild = await request("GET", "discord.com",
      `/api/v10/guilds/${GUILD_ID}?with_counts=true`,
      { Authorization: `Bot ${BOT_TOKEN}` });
    lines.push(`Members: ${guild.data?.approximate_member_count || "?"}`);
  } catch {}

  if (GENERAL_CHANNEL) {
    try {
      await sleep(300);
      const msgs = await request("GET", "discord.com",
        `/api/v10/channels/${GENERAL_CHANNEL}/messages?limit=10`,
        { Authorization: `Bot ${BOT_TOKEN}` });
      if (Array.isArray(msgs.data)) {
        const human = msgs.data.filter((m) => !m.author?.bot);
        if (human.length > 0) {
          lines.push("Recent #general topics:");
          for (const m of human.slice(0, 5)) {
            lines.push(`- ${m.author.username}: ${(m.content || "").slice(0, 80)}`);
          }
        }
      }
    } catch {}
  }

  return lines.join("\n");
}

async function main() {
  if (!GEMINI_KEY) { log("ERROR: GEMINI_API_KEY required"); process.exit(1); }
  if (!WEBHOOK_URL) { log("ERROR: MEETING_WEBHOOK_URL or GENERAL_WEBHOOK_URL required"); process.exit(1); }

  log("Collecting data...");
  const discordCtx = await getDiscordContext();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const agentNames = AGENTS.map((a) => a.id).join(", ");

  // ── Customize this prompt for your community ──
  const prompt = `You are a Discord meeting script generator. This meeting happens in a public channel — community members are watching.

## Agents
${AGENTS.map((a) => `- ${a.id}: ${a.personality}`).join("\n")}

## Today: ${today}

${discordCtx}

## Rules
1. Generate 6-8 messages as natural conversation
2. Talk about community topics first (new members, what people are discussing)
3. Product updates in plain language (no internal jargon)
4. Agents banter, tease each other, disagree — NOT formal reports
5. Each message: 30-80 chars, casual, occasional emoji
6. CEO opens and closes. Closing line = open question for community (no @mentions)
7. Output valid JSON only

## Output Format
{"conversation":[{"agent":"CEO","msg":"..."},{"agent":"Security","msg":"..."},...]}

agent must be one of: ${agentNames}`;

  log("Calling Gemini Flash...");
  const res = await request("POST", "generativelanguage.googleapis.com",
    `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    { "Content-Type": "application/json" },
    JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 2048, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    }));

  const rawText = res.data?.candidates?.[0]?.content?.parts
    ?.filter((p) => !p.thought).map((p) => p.text).join("") || "";
  const cleaned = rawText.replace(/^```json\s*/, "").replace(/```\s*$/, "");

  let meeting;
  try {
    meeting = JSON.parse(cleaned);
  } catch (e) {
    log(`Parse error: ${e.message}`);
    log(`Raw: ${rawText.slice(0, 300)}`);
    process.exit(1);
  }

  const msgs = meeting.conversation || meeting;
  log(`Generated ${msgs.length} messages`);

  if (DRY_RUN) {
    for (const m of msgs) console.log(`[${m.agent}] ${m.msg}`);
    process.exit(0);
  }

  // Post each message with agent-specific avatar
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const agent = AGENTS.find((a) => a.id === m.agent) || AGENTS[0];

    const url = new URL(WEBHOOK_URL);
    await request("POST", url.hostname, url.pathname,
      { "Content-Type": "application/json" },
      JSON.stringify({
        content: m.msg,
        username: agent.name,
        avatar_url: agent.avatar || undefined,
      }));

    log(`Posted [${m.agent}]: ${m.msg.slice(0, 60)}`);

    if (i < msgs.length - 1) {
      const delay = 30000 + Math.random() * 45000; // 30-75 seconds between messages
      await sleep(delay);
    }
  }

  log("Meeting complete");
}

main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
