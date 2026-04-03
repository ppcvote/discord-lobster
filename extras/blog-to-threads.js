#!/usr/bin/env node
// blog-to-threads.js — Auto-convert blog posts into Threads teasers
//
// Picks a random blog post that hasn't been shared yet,
// generates a 100-200 char teaser via Gemini Flash,
// posts to Threads via MindThread API.
//
// Cron: once daily
// Requires: GEMINI_API_KEY, MINDTHREAD_API_KEY, MINDTHREAD_ACCOUNT_ID in .env

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
const MT_KEY = process.env.MINDTHREAD_API_KEY || "";
const MT_ACCOUNT = process.env.MINDTHREAD_ACCOUNT_ID || "";
const BLOG_DIR = process.env.BLOG_DIR || "./blog";
const BLOG_URL = process.env.BLOG_BASE_URL || "https://example.com/blog";
const DATA_DIR = path.join(__dirname, "..", "data");
const LOG_DIR = path.join(__dirname, "..", "logs");
const POSTED_FILE = path.join(DATA_DIR, "blog-threads-posted.json");
const DRY_RUN = process.argv.includes("--dry-run");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `[${ts}] ${msg}\n`;
  try { fs.appendFileSync(path.join(LOG_DIR, "blog-to-threads.log"), line); } catch {}
  console.log(line.trim());
}

function gemini(prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } },
    });
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(d);
          const text = parsed.candidates?.[0]?.content?.parts
            ?.filter((p) => !p.thought).map((p) => p.text).join("") || "";
          resolve(text.trim());
        } catch { reject(new Error("Gemini parse error")); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function pickBlog(posted) {
  if (!fs.existsSync(BLOG_DIR)) { log(`ERROR: BLOG_DIR not found: ${BLOG_DIR}`); process.exit(1); }
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
  for (const f of files) {
    const slug = f.replace(".md", "");
    if (!posted.includes(slug)) return { file: path.join(BLOG_DIR, f), slug };
  }
  log("All posts shared, resetting cycle");
  return { file: path.join(BLOG_DIR, files[0]), slug: files[0].replace(".md", "") };
}

async function main() {
  if (!GEMINI_KEY) { log("ERROR: GEMINI_API_KEY required"); process.exit(1); }

  let posted = [];
  try { posted = JSON.parse(fs.readFileSync(POSTED_FILE, "utf8")); } catch {}

  const { file, slug } = pickBlog(posted);
  const url = `${BLOG_URL}/${slug}`;
  log(`Selected: ${slug}`);

  const raw = fs.readFileSync(file, "utf8");
  const titleMatch = raw.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  const title = titleMatch ? titleMatch[1] : slug;
  const body = raw.replace(/---[\s\S]*?---/, "").trim().slice(0, 800);

  // ── Customize this prompt for your brand ──
  const prompt = `Turn this blog post into a short social media teaser (100-200 chars).

Title: ${title}
Content: ${body}

Rules:
1. Start with an attention-grabbing hook (question, stat, or counterintuitive take)
2. 2-3 sentences of key insights (use numbers, not adjectives)
3. End with: "Full article 👉 ${url}"
4. Casual tone, like sharing with a friend
5. Don't start with "Hey everyone" or "Today I want to share"
6. Max 2 emoji
7. Add 2-3 relevant hashtags

Output only the post text.`;

  let teaser = await gemini(prompt);
  teaser = teaser.replace(/^好的[，,。]?\s*/g, "").replace(/^以下是[^：]*：?\s*/g, "").trim();

  if (teaser.length < 50) { log(`ERROR: Teaser too short (${teaser.length})`); process.exit(1); }

  log(`Generated (${teaser.length} chars): ${teaser.slice(0, 80)}...`);

  if (DRY_RUN) {
    console.log("\n=== PREVIEW ===\n" + teaser + "\n=== END ===");
    process.exit(0);
  }

  if (!MT_KEY || !MT_ACCOUNT) {
    log("No MINDTHREAD_API_KEY or MINDTHREAD_ACCOUNT_ID — printing only");
    console.log(teaser);
    posted.push(slug);
    fs.writeFileSync(POSTED_FILE, JSON.stringify(posted, null, 2));
    process.exit(0);
  }

  const scheduleTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const result = await httpPost("https://api.mindthread.tw/api/posts/schedule", {
    accountId: MT_ACCOUNT, content: teaser, scheduledAt: scheduleTime,
  }, { "x-api-key": MT_KEY });

  if (result.body.includes("success") || result.body.includes("id")) {
    log(`Scheduled to Threads (HTTP ${result.status})`);
    posted.push(slug);
    fs.writeFileSync(POSTED_FILE, JSON.stringify(posted, null, 2));
  } else {
    log(`Failed (HTTP ${result.status}): ${result.body.slice(0, 200)}`);
  }

  log("Done");
}

main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
