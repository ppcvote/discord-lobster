#!/usr/bin/env node
// welcome.js — Auto-welcome new Discord members with AI-generated personality
//
// Detects new joins via audit log, generates personalized welcome messages
// using Gemini Flash, posts via webhook. Also responds to text self-introductions.
//
// Run every 3 minutes via cron.

const path = require("path");
const config = require("./lib/config");
const {
  log: _log, discordApi, geminiGenerate, postWebhook,
  loadJson, saveJson, sleep, sanitize,
} = require("./lib/utils");

const log = (msg) => _log("welcome", msg);
const STATE_FILE = path.join(config.DATA_DIR, "welcome-state.json");

function loadMemoryContext(userId) {
  const mem = loadJson(config.MEMORY_FILE) || {};
  const info = mem[userId];
  if (!info) return "";
  const parts = [];
  if (info.background) parts.push(`Background: ${info.background}`);
  if (info.interests?.length) parts.push(`Interests: ${info.interests.join(", ")}`);
  if (info.projects) parts.push(`Working on: ${info.projects}`);
  return parts.length > 0 ? `\n\nYour memory of this person:\n${parts.join("\n")}` : "";
}

async function main() {
  const state = loadJson(STATE_FILE) || { welcomedUsers: [], respondedMsgIds: [], lastAuditCheck: 0 };
  const now = Date.now();
  const lastCheck = state.lastAuditCheck || (now - 5 * 60 * 1000);
  let acted = false;

  // ── Mode 1: New member joins (audit log) ──
  const auditData = await discordApi("GET", `/guilds/${config.GUILD_ID}/audit-logs?action_type=25&limit=20`);
  const newUsers = [];

  if (auditData?.audit_log_entries) {
    for (const entry of auditData.audit_log_entries) {
      const entryTime = Number(BigInt(entry.id) >> 22n) + 1420070400000;
      if (entryTime <= lastCheck) continue;
      const user = (auditData.users || []).find((u) => u.id === entry.target_id);
      if (!user || user.bot) continue;
      if (state.welcomedUsers.includes(user.id)) continue;
      newUsers.push(user);
    }
  }

  log(`Audit log: found ${newUsers.length} new member(s)`);

  if (newUsers.length > 0) {
    const individual = newUsers.slice(0, 3);
    const batched = newUsers.slice(3);

    for (const user of individual) {
      const mention = `<@${user.id}>`;
      const askRef = config.ASK_CHANNEL ? `<#${config.ASK_CHANNEL}>` : "the ask channel";
      const genRef = `<#${config.GENERAL_CHANNEL}>`;

      // ── Customize this prompt for your community's personality ──
      const prompt = `You are a friendly AI community manager with a fun personality. A new member just joined.

Username: ${user.username}

Write 1-2 sentences to welcome them. Rules:
- Find something fun about their username (puns, wordplay, references)
- If the username is hard to riff on, use a fun icebreaker question instead
- Sound like a friend, not a corporate bot
- End with a natural suggestion to check out ${askRef} or say hi in ${genRef}
- Max 1-2 emoji
- Do NOT start with "Welcome", "Hello", "Hi", or "Nice to meet you"
- Do NOT use @everyone or @here

Output only the response text.`;

      try {
        const response = sanitize(await geminiGenerate(prompt));
        await postWebhook(config.WELCOME_WEBHOOK_URL, `${mention} ${response}`);
        log(`Welcomed ${user.username}`);
        state.welcomedUsers.push(user.id);
        acted = true;
        await sleep(2000 + Math.random() * 3000);
      } catch (e) {
        log(`ERROR welcoming ${user.username}: ${e.message}`);
      }
    }

    if (batched.length > 0) {
      const mentions = batched.map((u) => `<@${u.id}>`).join(" ");
      const names = batched.map((u) => u.username).join(", ");
      const prompt = `You are a friendly AI community manager. ${batched.length} new people just joined at once.

Usernames: ${names}

Write 1-2 sentences welcoming them all. Make it fun — like "Is this a group tour?" or similar.
Max 1-2 emoji. No @everyone/@here. No generic greetings.

Output only the response.`;

      try {
        const response = sanitize(await geminiGenerate(prompt));
        await postWebhook(config.WELCOME_WEBHOOK_URL, `${mentions} ${response}`);
        log(`Batch welcomed ${batched.length} users`);
        for (const u of batched) state.welcomedUsers.push(u.id);
        acted = true;
      } catch (e) {
        log(`ERROR batch welcome: ${e.message}`);
      }
    }
  }

  state.lastAuditCheck = now;

  // ── Mode 2: Respond to text self-introductions ──
  await sleep(500);
  const msgs = await discordApi("GET", `/channels/${config.WELCOME_CHANNEL}/messages?limit=15`);
  if (msgs && Array.isArray(msgs)) {
    const tenMinAgo = now - 10 * 60 * 1000;
    const textIntros = msgs.filter((m) => {
      if (m.author.bot) return false;
      if (state.respondedMsgIds.includes(m.id)) return false;
      if (new Date(m.timestamp).getTime() < tenMinAgo) return false;
      return (m.content || "").trim().length >= 5;
    });

    for (const intro of textIntros.slice(0, 3).reverse()) {
      const mention = `<@${intro.author.id}>`;
      const content = (intro.content || "").trim();
      const memCtx = loadMemoryContext(intro.author.id);

      const prompt = `You are a friendly AI community manager. Someone wrote a self-introduction in #welcome.

Username: ${intro.author.username}
Introduction: ${content}${memCtx}

Write 1-3 sentences responding to their intro. Rules:
- Reference what they actually said (job, interests, goals)
- Sound like a friend, not a bot
- Naturally guide them to the community channels
- Max 1-2 emoji. No @everyone/@here.

Output only the response.`;

      try {
        const response = sanitize(await geminiGenerate(prompt));
        await postWebhook(config.WELCOME_WEBHOOK_URL, `${mention} ${response}`);
        log(`Responded to intro from ${intro.author.username}`);
        state.respondedMsgIds.push(intro.id);
        acted = true;
        await sleep(2000 + Math.random() * 3000);
      } catch (e) {
        log(`ERROR responding to ${intro.author.username}: ${e.message}`);
      }
    }
  }

  // Trim state to prevent unbounded growth
  state.welcomedUsers = (state.welcomedUsers || []).slice(-300);
  state.respondedMsgIds = (state.respondedMsgIds || []).slice(-300);
  saveJson(STATE_FILE, state);

  if (!acted) log("No new members or intros");
  log("Done");
}

main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
