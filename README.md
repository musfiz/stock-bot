# Inventory Bot

A grocery-shop chatbot that answers product price and stock questions in **Bengali, Banglish and English**. It finds the product with vector search (Qdrant), reads live price/stock from MySQL, and replies instantly from a template — using the LLM (`qwen2.5:3b`) only for fuzzy cases. Ships with a CLI, an Express API (SSE streaming), an embeddable website widget, and a retrieval inspector.

**License:** MIT — see [LICENSE](./LICENSE).

---

## 1. Features

- Product, variation, price and live-stock lookup (`product name + variation name + current stock`).
- Understands Bengali (`আটার দাম কত?`), Banglish (`atar dam koto`) and English (`Sugar stock?`).
- Natural conversation: greetings, thanks, goodbye, and follow-ups (`এর stock কত?` remembers the last product).
- Template-first replies: exact numbers, no hallucination, no LLM latency for clear questions.
- Express API with streaming (SSE) + JSON mode, per-session memory, rate limiting, CORS allow-list.
- Embeddable `chat-widget.js` for any website + `chat-inspector.html` debug panel (products, scores, stock).
- Zero-downtime product sync via Qdrant alias swap. Stock is always read live — never synced.

Out of scope for v1: orders, cart, payments, FAQ/policies, recommendations, anything that writes to the DB.

## 2. How it works

```
Customer question
      │
      ▼
detectLang (Bengali script? bn : en) + social check (hi/salam/thanks/bye)
      │  social → template reply, no retrieval, no LLM
      ▼
alias match (আটা/atar/ata → Atta)? ──yes──► MySQL direct lookup (no embedding)
      │ no
      ▼
mentions a known product? ──no──► "not found" template (no embedding, no LLM)
      │ yes
      ▼
bge-m3 embedding (cached) → Qdrant top-3 within score window
      │
      ▼
MySQL live price + stock (product & variation queries in parallel)
      │
      ├── single product + price/stock intent → bn/en template reply (no LLM)
      ├── nothing found → polite "not found" template
      └── fuzzy/ambiguous → qwen2.5:3b with compact product context
```

## 3. Requirements

| Dependency | Version used | Purpose |
|---|---|---|
| Node.js | 18+ (tested 24) | Runtime |
| MySQL | any 8.x | Products, variations, live stock |
| Qdrant | 1.19+ at `http://localhost:6333` | Vector search |
| Ollama | 0.40+ | Local models |
| Ollama model `bge-m3` | ~1.2 GB | Multilingual embeddings |
| Ollama model `qwen2.5:3b` | ~2 GB | Chat replies (fuzzy cases) |

The MySQL database must contain `products`, `categories`, `units`, `product_variations` and `stocks` tables (your existing shop database). The bot only runs `SELECT` queries.

## 4. Step-by-step setup

### Step 0 — Install the services

1. Install **Node.js 18+**, **MySQL 8**, **Ollama**, and **Qdrant** (Qdrant can run via Docker: `docker run -p 6333:6333 qdrant/qdrant`).
2. Start MySQL, Qdrant and the Ollama server.

### Step 1 — Pull the Ollama models

```bash
ollama pull bge-m3
ollama pull qwen2.5:3b
```

Keep both models warm in RAM (recommended, needs ~4 GB):

```bash
# on the machine running the Ollama server:
OLLAMA_MAX_LOADED_MODELS=2
```

### Step 2 — Create a read-only MySQL user

```sql
CREATE USER 'inventory_reader'@'localhost' IDENTIFIED BY 'change-me';
GRANT SELECT ON grocery.* TO 'inventory_reader'@'localhost';
```

Replace `grocery` with your database name.

### Step 3 — Install the project

```bash
cd inventory-bot
npm install
copy .env.example .env
```

Then edit `.env` (DB credentials, model names, port, allowed website origins):

```bash
# .env
DB_USER=inventory_reader
DB_PASSWORD=change-me
ALLOWED_ORIGINS=http://localhost:3000,https://your-shop.com
```

All settings and defaults are listed in [section 6](#6-configuration).

### Step 4 — Sync products into Qdrant (one time, and after product changes)

```bash
npm run sync
```

This embeds product names (+ Banglish/Bengali aliases) and builds a fresh collection, then swaps the `products` alias to it — search never goes offline. Expected output ends with `24 টা product sync হয়েছে` (your count may differ).

### Step 5 — Try the CLI chat

```bash
npm run chat
```

Test questions:

```
hi                  → greeting, no product search
আটার দাম কত?        → Bengali template with variations + stock
atar dam koto       → Banglish, same answer
Sugar stock?        → polite "not found" (no such product)
muri ache?          → Puffed Rice stock
এর stock কত?        → follow-up, reuses the last product
exit                → quit
```

### Step 6 — Start the website API

```bash
npm run server
# Chat API চালু: http://localhost:3000
```

### Step 7 — Open the inspector (debug UI)

Open `http://localhost:3000/chat-inspector.html` in a browser (served by the API, so no CORS issues). Send a message, and watch the reply stream on the left and the retrieved products, match scores and stock on the right.

### Step 8 — Embed the widget on your website

```html
<script src="http://localhost:3000/chat-widget.js"
        data-api="http://localhost:3000"></script>
```

Serve `ui/chat-widget.js` from your API/static host in production and point `data-api` at it. Make sure your shop domain is in `ALLOWED_ORIGINS`, otherwise the browser will block the calls.

## 5. Resyncing after product changes

Stock is read live from MySQL — no sync needed for stock. After adding/editing **products**, resync:

```bash
npm run sync
```

or via the admin endpoint (set `ADMIN_TOKEN` in `.env` first):

```bash
curl -X POST http://localhost:3000/admin/resync -H "x-admin-token: <ADMIN_TOKEN>"
```

## 6. Configuration

All settings live in `.env` (see `.env.example`). Code defaults apply when a key is missing.

| Key | Default | Description |
|---|---|---|
| `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `localhost` / `root` / (empty) / `grocery` | MySQL connection (use the read-only user) |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server |
| `EMBED_MODEL` | `bge-m3` | Embedding model (must match `EMBED_DIM`) |
| `CHAT_MODEL` | `qwen2.5:3b` | Chat model for fuzzy cases |
| `COLLECTION` | `products` | Qdrant collection/alias name |
| `EMBED_DIM` | `1024` | Embedding vector width |
| `OLLAMA_KEEP_ALIVE` | `30m` | Keep models loaded in RAM |
| `PORT` | `3000` | API port |
| `ALLOWED_ORIGINS` | (empty = allow all, demo only) | Comma-separated CORS allow-list |
| `ADMIN_TOKEN` | (empty = no auth) | Required `x-admin-token` for `/admin/*` when set |

## 7. API reference

### `GET /meta`

```json
{ "chatModel": "qwen2.5:3b", "embedModel": "bge-m3" }
```

### `POST /chat` — JSON mode (`stream: false`)

Request: `{ "message": "atar dam koto", "sessionId": "<optional>", "stream": false }`

Response:

```json
{
  "reply": "Atta is available.\n- Pure 1Kg: price 60, stock 10 ...",
  "sessionId": "d1e70173-...",
  "debug": { "lang": "en", "products": [{ "id": 12, "name": "Atta", "match": 1, "stock_qty": 10, "variations": [...] }] }
}
```

Rules: `message` required, max 300 chars (`400` otherwise). History is kept **server-side** per `sessionId` (8 messages); never send history from the browser.

### `POST /chat` — SSE stream (default)

Same request with `"stream": true` (or omitted). Events:

- `event: debug` — retrieval result (products, scores, variations, stock)
- `event: token` — one reply chunk (JSON string)
- `event: done` — `{ "sessionId": "..." }`

Closing the connection stops generation (CPU-friendly). Rate limit: 30 req/min per IP.

### `POST /admin/resync`

Runs product sync, returns `{ "synced": 24 }`. Rate limit: 10 req/min.

## 8. Project structure

```
bot.js                 → detectLang, social/templates, retrieve(+alias/window), ask()
aliases.js             → Banglish/Bengali alias table (matched before embeddings)
embed.js               → ollama.embed with query cache + strict dimension check
sync.js                → builds fresh Qdrant collection, swaps alias; also /admin/resync
chat.js                → CLI chat (streams chunks as they arrive)
server.js              → Express API: /chat (SSE+JSON), /meta, /admin/resync
warmup.js              → preloads both models at startup
config.js              → .env settings, Qdrant + MySQL clients
ui/chat-widget.js      → embeddable website chat bubble
ui/chat-inspector.html → live chat + retrieval debug panel
docs/plan.md           → original design plan (v1 scope, phases, verification)
```

## 9. Performance notes (16 GB, CPU-only PC)

- Template replies skip the LLM entirely — the biggest saving.
- `keep_alive: 30m` + warmup avoids model reloads between turns.
- Short English system prompt (Bengali costs many tokens) with `num_ctx: 2048`, `num_predict: 150`.
- One local CPU model serves one chat at a time — fine for dev/demo; for real traffic use a CPU server with a hosted LLM API or a GPU machine.

## 10. Security notes

- Bot issues only `SELECT` queries — use the read-only MySQL user from Step 2.
- Never commit `.env` (already in `.gitignore`); copy from `.env.example`.
- Set `ALLOWED_ORIGINS` to your shop domain(s) in production.
- User text is untrusted prompt input: the "data is the only source of truth" rule stays in every LLM call, and secrets are never placed in context.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| `embedding … ডাইমেনশনের` error | `EMBED_MODEL` and `EMBED_DIM` mismatch — re-pull the model or fix `.env`, then `npm run sync` |
| Slow first reply | Models loading — check warmup ran; set `OLLAMA_MAX_LOADED_MODELS=2` |
| `কোনো পণ্য পাইনি` for a real product | Add its Banglish/Bengali spellings to `aliases.js`, then `npm run sync` |
| Widget blocked in browser | Add your domain to `ALLOWED_ORIGINS` and restart the server |
| `601/ECONNREFUSED` from Qdrant/MySQL/Ollama | Start the service; check `QDRANT_URL`, `.env` DB settings |
| `message too long` | Client must keep messages ≤ 300 chars |

## 12. License

MIT — free for commercial use. See [LICENSE](./LICENSE).
