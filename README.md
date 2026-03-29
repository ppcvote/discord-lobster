# Lobster Kit

**Discord AI Community Manager — Open Source**

**[English](#english) | [繁體中文](#繁體中文)**

---

<a name="english"></a>

## What is this?

Lobster Kit makes your Discord server feel alive — without you being online 24/7.

It uses **Gemini Flash (free)** to:
- **Welcome new members** with personalized humor (not "Welcome! Read the rules!")
- **Chime into conversations** when there's something worth adding
- **Remember every member** — their background, interests, and projects
- **Reply when someone responds** to the lobster's messages

Zero npm dependencies. Zero database. **$0/month** running cost.

> Battle-tested with 146+ members at [Ultra Lab HQ](https://discord.gg/ewS4rWXvWk). Join and see it live.

## Quick Start

```bash
git clone https://github.com/ppcvote/discord-lobster.git
cd lobster-kit
cp .env.example .env
# Edit .env with your tokens and channel IDs
```

### Prerequisites

- Node.js 18+
- Discord bot with **Message Content Intent** enabled ([guide](https://discord.com/developers/docs/events/gateway#message-content-intent))
- Gemini API key (free: [aistudio.google.com/apikeys](https://aistudio.google.com/apikeys))
- Discord webhook(s) in target channels

### Run

```bash
node welcome.js    # Welcome new members (cron: every 3 min)
node vibes.js      # Chime into #general (cron: every 20 min)
node memory.js     # Build member memory (cron: every 10 min)
```

### Cron Setup (Linux/WSL)

```cron
*/3 * * * * cd /path/to/lobster-kit && node welcome.js >> logs/welcome.log 2>&1
*/20 * * * * cd /path/to/lobster-kit && node vibes.js >> logs/vibes.log 2>&1
*/10 * * * * cd /path/to/lobster-kit && node memory.js >> logs/memory.log 2>&1
```

## How It Works

### Welcome Flow

```
New member joins → Audit log detected (every 3 min)
    → Gemini reads username → generates personalized welcome
    → Posts via webhook as "Lobster CEO"
    → Member feels seen → stays and chats
```

### Conversation Flow

```
2+ humans chatting in #general → Lobster reads last 20 messages
    → Gemini decides: worth chiming in?
    → YES → posts a relevant comment (then 60 min cooldown)
    → NO → stays quiet
```

### Reply Detection

```
Someone replies to lobster's message (within 5 min)
    → Skips cooldown → generates contextual response
    → Conversation continues naturally
```

### Memory System

```
"I'm a physical therapist interested in AI"
    → Extracted: { background: "physical therapist", interests: ["AI"] }
    → Stored in data/member-memory.json
    → Next interaction: "Didn't you say you do rehab? AI can automate your booking system"
```

## Customization

### Personality

Every script has Gemini prompts you can edit. Search for `Customize this prompt` in the source files.

Examples:
- **Professional community** → dry humor, helpful tone
- **Meme server** → chaotic energy, roasts allowed
- **Learning community** → encouraging, educational

### Tuning

| Setting | File | Default | What it does |
|---------|------|---------|-------------|
| Welcome frequency | `welcome.js` cron | 3 min | How often to check for new members |
| Chime-in cooldown | `vibes.js` | 60 min | Min time between lobster messages |
| Min conversation | `vibes.js` | 2 humans | Minimum people chatting to trigger |
| Memory scan | `memory.js` cron | 10 min | How often to update member profiles |

## Architecture

```
lobster-kit/
├── welcome.js      # New member welcome + intro responses
├── vibes.js        # Casual conversation participation
├── memory.js       # Member profile extraction
├── lib/
│   ├── config.js   # .env loader + configuration
│   └── utils.js    # Discord API, Gemini, webhook helpers
├── data/           # Runtime state (gitignored)
├── logs/           # Log files (gitignored)
├── .env.example    # Configuration template
└── .env            # Your secrets (gitignored)
```

**Zero dependencies** — uses only Node.js built-in `https`, `fs`, `path`, `crypto` modules.

## Setup Service

Don't want to set it up yourself? We offer done-for-you deployment:

- Custom personality tuning for your community
- Webhook + cron configuration
- 30-day support

**[Contact Ultra Lab →](https://ultralab.tw/#contact)**

---

<a name="繁體中文"></a>

## 這是什麼？

Lobster Kit 讓你的 Discord 自己活起來 — 不需要你 24 小時在線。

用 **Gemini Flash（免費）** 驅動：
- **自動歡迎新人** — 根據用戶名客製化幽默回應（不是「歡迎！請看規則」）
- **在聊天室偶爾插嘴** — 有梗才說，沒事就安靜
- **記住每個成員** — 職業、興趣、正在做什麼
- **有人回覆龍蝦就接話** — 自然地繼續對話

零 npm 依賴。零資料庫。**$0/月** 運行成本。

> 在 [一人公司實驗室](https://discord.gg/ewS4rWXvWk)（146+ 成員）實戰驗證。加入看活 demo。

## 快速開始

```bash
git clone https://github.com/ppcvote/discord-lobster.git
cd lobster-kit
cp .env.example .env
# 編輯 .env 填入你的 token 和頻道 ID
```

### 需要的東西

- Node.js 18+
- Discord bot（要開啟 **Message Content Intent**）
- Gemini API key（免費：[aistudio.google.com/apikeys](https://aistudio.google.com/apikeys)）
- Discord webhook

### 執行

```bash
node welcome.js    # 歡迎新人（cron: 每 3 分鐘）
node vibes.js      # 在 #general 插嘴（cron: 每 20 分鐘）
node memory.js     # 建立成員記憶（cron: 每 10 分鐘）
```

## 客製化

每個腳本裡都有 Gemini prompt 可以改。搜尋 `Customize this prompt` 就能找到。

想改成中文回應？直接改 prompt 裡的語言指示就好：
```
// 改成繁體中文回應
"用 1-2 句繁體中文歡迎他..."
```

## 代客設定服務

不想自己弄？我們提供一站式部署：

- 依你的社群風格調教龍蝦個性
- Webhook + 排程設定
- 30 天支援

**[聯繫 Ultra Lab →](https://ultralab.tw/#contact)**

---

## Credits

Built by [Ultra Lab](https://ultralab.tw) — a one-person AI product studio from Taiwan.

4 AI agents running 24/7 at $0/month. We build AI products AND help you build yours.

[![Discord](https://img.shields.io/discord/1459618830773911633?color=5865F2&label=Discord&logo=discord&logoColor=white)](https://discord.gg/ewS4rWXvWk)

## License

MIT
