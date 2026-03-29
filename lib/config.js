// config.js — Load configuration from .env or environment variables
// Zero dependencies: reads .env file manually

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, "..", ".env");

// Load .env into process.env (real env vars take priority)
try {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

function required(key) {
  const val = process.env[key];
  if (!val) {
    console.error(`ERROR: ${key} is required. Set it in .env or environment.`);
    process.exit(1);
  }
  return val;
}

module.exports = {
  DISCORD_BOT_TOKEN: required("DISCORD_BOT_TOKEN"),
  GEMINI_API_KEY: required("GEMINI_API_KEY"),
  GUILD_ID: required("GUILD_ID"),
  WELCOME_CHANNEL: required("WELCOME_CHANNEL_ID"),
  GENERAL_CHANNEL: required("GENERAL_CHANNEL_ID"),
  ASK_CHANNEL: process.env.ASK_CHANNEL_ID || "",
  WELCOME_WEBHOOK_URL: required("WELCOME_WEBHOOK_URL"),
  GENERAL_WEBHOOK_URL: required("GENERAL_WEBHOOK_URL"),
  BOT_NAME: process.env.BOT_NAME || "Lobster CEO \u{1F99E}",
  BOT_AVATAR_URL: process.env.BOT_AVATAR_URL || "",

  // Paths
  DATA_DIR: path.join(__dirname, "..", "data"),
  LOG_DIR: path.join(__dirname, "..", "logs"),
  MEMORY_FILE: path.join(__dirname, "..", "data", "member-memory.json"),
};
