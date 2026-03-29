#!/usr/bin/env node
// memory.js — Build a memory of community members from conversations
//
// Scans recent messages, extracts key info (background, interests, projects)
// via Gemini, stores in a JSON file. Other scripts use this memory to
// personalize responses.
//
// Run every 10 minutes via cron.

const path = require("path");
const config = require("./lib/config");
const {
  log: _log, discordApi, geminiGenerate,
  loadJson, saveJson, sleep,
} = require("./lib/utils");

const log = (msg) => _log("memory", msg);
const STATE_FILE = path.join(config.DATA_DIR, "memory-state.json");

async function main() {
  const memory = loadJson(config.MEMORY_FILE) || {};
  const state = loadJson(STATE_FILE) || { lastProcessedIds: {} };

  // Scan these channels for member info
  const channels = [config.GENERAL_CHANNEL, config.WELCOME_CHANNEL];
  if (config.ASK_CHANNEL) channels.push(config.ASK_CHANNEL);

  const allMessages = [];

  for (const chId of channels) {
    await sleep(300);
    const msgs = await discordApi("GET", `/channels/${chId}/messages?limit=30`);
    if (!msgs || !Array.isArray(msgs)) continue;

    for (const m of msgs) {
      if (m.author.bot) continue;
      const lastId = state.lastProcessedIds[chId] || "0";
      if (BigInt(m.id) <= BigInt(lastId)) continue;
      allMessages.push({
        userId: m.author.id,
        username: m.author.username,
        content: (m.content || "").trim(),
        channel: chId,
      });
    }

    // Update last processed ID
    if (msgs.length > 0) {
      const maxId = msgs[0].id;
      const prevId = state.lastProcessedIds[chId] || "0";
      if (BigInt(maxId) > BigInt(prevId)) {
        state.lastProcessedIds[chId] = maxId;
      }
    }
  }

  const meaningful = allMessages.filter((m) => m.content.length >= 3);

  if (meaningful.length === 0) {
    log("No new meaningful messages");
    saveJson(STATE_FILE, state);
    process.exit(0);
  }

  log(`Processing ${meaningful.length} messages from ${new Set(meaningful.map((m) => m.username)).size} users`);

  // Group by user
  const byUser = {};
  for (const m of meaningful) {
    if (!byUser[m.username]) byUser[m.username] = { userId: m.userId, msgs: [] };
    byUser[m.username].msgs.push(m.content);
  }

  const userSummaries = Object.entries(byUser).map(([username, data]) => {
    const existing = memory[data.userId];
    const existingInfo = existing ? `Known: ${JSON.stringify(existing)}` : "No prior info";
    return `User "${username}" (ID: ${data.userId})
${existingInfo}
Recent messages:
${data.msgs.map((m) => `- ${m.slice(0, 200)}`).join("\n")}`;
  }).join("\n\n");

  // ── Customize this prompt for your community's language ──
  const prompt = `Extract key info about each user from these Discord messages.

${userSummaries}

Rules:
1. Extract: background/job, interests, skill level, current projects, personality
2. If user has existing data, merge new info (don't overwrite unless contradicted)
3. If messages are too short to learn anything, keep existing data
4. Do NOT invent information not mentioned in messages

Output a flat JSON object. Keys must be the user's numeric ID string.

Example:
{
  "254859724133105664": {
    "username": "chord210",
    "background": "Physical therapist",
    "interests": ["AI automation", "vibe coding"],
    "level": "beginner",
    "projects": null,
    "personality": "friendly, humorous",
    "connections": "chatted with owner",
    "notes": "morning shift worker",
    "lastSeen": "2026-03-23"
  }
}`;

  try {
    const result = await geminiGenerate(prompt);
    const cleaned = result.replace(/^```json\s*/, "").replace(/```\s*$/, "");
    const updates = JSON.parse(cleaned);

    let count = 0;
    for (const [userId, info] of Object.entries(updates)) {
      if (!userId || userId === "undefined") continue;
      const existing = memory[userId] || {};
      memory[userId] = {
        ...existing,
        ...info,
        interests: [...new Set([...(existing.interests || []), ...(info.interests || [])])],
        updatedAt: new Date().toISOString(),
        firstSeen: existing.firstSeen || new Date().toISOString(),
      };
      count++;
    }

    log(`Updated ${count} user profiles`);
    saveJson(config.MEMORY_FILE, memory);
  } catch (e) {
    log(`ERROR: ${e.message}`);
  }

  saveJson(STATE_FILE, state);
  log("Done");
}

main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
