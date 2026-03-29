#!/usr/bin/env node
// vibes.js — Lobster casually chimes into #general conversations
//
// Monitors recent messages. If there's an interesting conversation,
// lobster adds a comment. If someone replies to the lobster, it responds.
// Stays quiet when there's nothing to add.
//
// Anti-annoyance: 60 min cooldown, minimum 2 humans chatting, Gemini decides.
// Run every 20 minutes via cron.

const path = require("path");
const config = require("./lib/config");
const {
  log: _log, discordApi, geminiGenerate, postWebhook,
  loadJson, saveJson, sanitize,
} = require("./lib/utils");

const log = (msg) => _log("vibes", msg);
const STATE_FILE = path.join(config.DATA_DIR, "vibes-state.json");

async function main() {
  const state = loadJson(STATE_FILE) || { lastResponseAt: 0 };
  const now = Date.now();

  // Fetch last 20 messages from #general
  const msgs = await discordApi("GET", `/channels/${config.GENERAL_CHANNEL}/messages?limit=20`);
  if (!msgs || !Array.isArray(msgs)) {
    log("ERROR: Could not fetch messages");
    process.exit(1);
  }

  // Find lobster's most recent message
  const lobsterMsg = msgs.find((m) =>
    m.author.bot && (m.author.username || "").includes(config.BOT_NAME.split(" ")[0])
  );
  const lobsterMsgTime = lobsterMsg ? new Date(lobsterMsg.timestamp).getTime() : 0;
  const lobsterMsgId = lobsterMsg ? lobsterMsg.id : null;

  // Check if someone replied to lobster
  const fiveMinAgo = now - 5 * 60 * 1000;
  const replyToLobster = msgs.find((m) => {
    if (m.author.bot) return false;
    if (new Date(m.timestamp).getTime() < fiveMinAgo) return false;
    return m.message_reference?.message_id === lobsterMsgId;
  });

  const isReplyMode = Boolean(replyToLobster);

  if (isReplyMode) {
    log(`Reply detected from ${replyToLobster.author.username}`);
  } else {
    // Normal mode: cooldown + anti-spam
    const COOLDOWN_MS = 20 * 60 * 1000;
    if (now - (state.lastResponseAt || 0) < COOLDOWN_MS) {
      log("Cooldown active, skipping");
      process.exit(0);
    }

    const sixtyMinAgo = now - 60 * 60 * 1000;
    if (lobsterMsgTime > sixtyMinAgo) {
      log("Lobster spoke in last 60 min, skipping");
      process.exit(0);
    }
  }

  // Get recent human messages
  const cutoff = isReplyMode ? fiveMinAgo : (now - 30 * 60 * 1000);
  const recentHuman = msgs.filter((m) => {
    if (m.author.bot) return false;
    return new Date(m.timestamp).getTime() > cutoff;
  });

  if (!isReplyMode && recentHuman.length < 2) {
    log("Not enough recent conversation, skipping");
    process.exit(0);
  }

  // Build conversation context
  const convoLines = recentHuman.slice(0, 15).reverse()
    .map((m) => `[${m.author.username}] ${(m.content || "").trim()}`)
    .join("\n");

  // Load member memory
  const mem = loadJson(config.MEMORY_FILE) || {};
  const activeUserIds = [...new Set(recentHuman.map((m) => m.author.id))];
  const memoryLines = activeUserIds
    .map((id) => {
      const info = mem[id];
      if (!info) return null;
      const parts = [];
      if (info.background) parts.push(info.background);
      if (info.interests?.length) parts.push(`interests: ${info.interests.join(", ")}`);
      return parts.length > 0 ? `- ${info.username}: ${parts.join(", ")}` : null;
    })
    .filter(Boolean).join("\n");
  const memorySection = memoryLines ? `\n\nYour memory of these people:\n${memoryLines}` : "";

  let prompt;

  if (isReplyMode) {
    const replyContent = (replyToLobster.content || "").trim();
    const lobsterSaid = lobsterMsg ? (lobsterMsg.content || "").trim() : "";

    // ── Customize this prompt for your community ──
    prompt = `You are a friendly AI community manager chatting in #general. Someone replied to your message.

You said: ${lobsterSaid}

${replyToLobster.author.username} replied: ${replyContent}

Recent context:
${convoLines}${memorySection}

Continue the conversation naturally. 1-2 sentences, casual tone. Max 1-2 emoji.
No @everyone/@here. No self-introduction.

Output only the response.`;
  } else {
    // ── Customize this prompt for your community ──
    prompt = `You are a friendly AI community manager. You're watching #general.

Recent conversation:
${convoLines}${memorySection}

Should you chime in? Only if:
- Someone asked a question you can answer
- Something funny was said and you have a good follow-up
- There's a topic you have genuine insight on

Do NOT chime in if:
- Two people are having a private conversation
- The topic is unrelated to you
- The mood is serious or negative

If you should NOT chime in, output: SKIP
If you should, output your message (1-2 sentences, casual, max 1 emoji).
No @everyone/@here. No self-introduction.`;
  }

  try {
    let response = sanitize(await geminiGenerate(prompt));

    if (!isReplyMode && (response === "SKIP" || response.startsWith("SKIP") || response.length < 3)) {
      log("Gemini says SKIP");
      process.exit(0);
    }
    if (response.startsWith("SKIP")) response = "\u{1F99E}";

    const status = await postWebhook(config.GENERAL_WEBHOOK_URL, response);
    log(`Chimed in #general (HTTP ${status}): ${response.slice(0, 80)}`);
    state.lastResponseAt = now;
    saveJson(STATE_FILE, state);
  } catch (e) {
    log(`ERROR: ${e.message}`);
  }
}

main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
