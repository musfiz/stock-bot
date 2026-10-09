# Inventory chatbot: website integration, speed and bn/en plan

The bot is currently a CLI. It retrieves a product from Qdrant, reads live stock and price from MySQL, and lets `qwen2.5:3b` write the reply. This plan makes replies smooth on a 16 GB / Intel Iris Xe PC, handles Bengali, Banglish and English input, wraps the bot in an Express API with a chat widget, and adds learning comments to every file.

## Project scope (v1)

- **In scope:**
  - Product, variation, price and stock lookup.
  - Greetings, small talk and follow-ups such as "এর দাম কত?".
  - Replies in the customer's language (Bengali or English).
- **Out of scope for v1:**
  - Orders, cart and payments.
  - FAQ and policies.
  - Recommendations.
  - Anything that writes to the database.
- **Data flow:**
  1. The question arrives.
  2. Language is detected.
  3. The product is found (alias or text match first, embeddings as fallback).
  4. Live price and stock are read from MySQL.
  5. The reply is built from a template, or from the LLM only for fuzzy cases.

## Why chat is not smooth on this PC

The Iris Xe has only 128 MB of dedicated video memory, and Ollama on Windows normally runs on the CPU for Intel iGPUs. Speed therefore depends on CPU and RAM bandwidth. Causes in the code:

1. `chat.js` waits 30 ms after every word (`setTimeout(r, 30)`). This is deliberate slowdown, and it only helps the CLI.
2. The Bengali system prompt in `bot.js` is long. Bengali costs many tokens per word, so the model re-reads a big prompt on every turn.
3. No `keep_alive`, `num_ctx` or `num_predict` is set. `bge-m3` and `qwen2.5:3b` can be unloaded and reloaded between turns, which costs seconds.
4. The LLM is used even when the answer is just "price X, stock Y". This is the biggest saving available.
5. A follow-up question calls the embedding model a second time.
6. The two SQL queries in `retrieve()` run one after the other.

## Models for 16 GB RAM, CPU only

- **Chat model:**
  - Keep `qwen2.5:3b` as the fast default.
  - Benchmark `gemma3:4b`, which usually writes better Bengali but is slower.
  - Avoid `llama3.2:3b` because its Bengali is weak.
  - If template replies cover most questions, a 1.5B model is enough for the rest.
- **Embedding model:**
  - Keep `bge-m3` because it is the best multilingual option for Bengali (about 1.2 GB).
  - Skip `nomic-embed-text` and `mxbai-embed-large` because they are English-focused.
  - Reduce calls with an alias match first and a query-embedding cache.
- Verify tokens per second on your machine with `ollama run <model> --verbose` before choosing.

## Steps

### Phase 1 – Speed (independent, do first)

1. In `chat.js`, remove the 30 ms delay and the word buffering. Print each chunk as it arrives.
2. In the `ollama.chat` and `ollama.embed` calls, set `keep_alive` to about 30 minutes. For chat also set `num_ctx` to about 2048 and `num_predict` to about 150.
3. Warm up both models at startup, and set `OLLAMA_MAX_LOADED_MODELS=2`.
4. Shorten `SYSTEM` in `bot.js` to 4–5 rules. Keep the stricter rules in the per-request instruction only where needed.
5. Skip the LLM for clear single-product lookups. Build the reply from a bn or en template using `formatContext` data, and call the LLM only for fuzzy cases.
6. Cache query embeddings (Map or LRU keyed by normalized text), and run the product and variation SQL queries together.
7. Optional: try Ollama's experimental Vulkan support (`OLLAMA_VULKAN=1`) or an Intel IPEX-LLM Ollama build. Both are unverified, so measure the result and don't rely on them.

### Phase 2 – Bengali, Banglish and English (depends on 1.5)

1. Add `detectLang(text)` using the Bengali Unicode range `\u0980-\u09FF`. Reply in the detected language, and drop the "MUST always reply in Bengali" rule.
2. Banglish ("atar dam koto") has no Bengali script, so use an alias table. Store `name_bn` and an `aliases` list (atta, আটা, ata) and match it before embedding. Add those aliases to the embedded text in `sync.js` too.
3. Fix `MIN_REL_MARGIN` in `retrieve()`. It rejects results when the top two are close, which breaks "Atta 1kg vs 2kg". Return all products within a small score window instead.
4. Fix the greeting regex typo (`আছ(o|েন)` has a Latin `o`). Add Banglish greetings and thanks.
5. Make `sync.js` build a new collection and swap it in, instead of deleting first. Remove the silent truncation in `fit()` in `embed.js`.

### Phase 3 – Website integration (depends on 1 and 2)

1. Add `server.js` (Express) with `POST /chat`. The request carries `message` and a `sessionId`. Keep per-session history on the server, capped at 8 messages, and don't trust history sent by the browser.
2. Stream the reply with Server-Sent Events by reusing the `ask()` async generator. Close the stream on `req.on('close')` so abandoned chats stop consuming the CPU.
3. Rewrite `ui/chat-inspector.html` as a small embeddable widget that `fetch`es `/chat`. Fix its hard-coded "gpt-4o-mini" label. Keep the inspector panel as a debug view that shows retrieved products and scores.
4. Add a re-sync trigger when products change (a cron job or an admin endpoint calling the sync code). Stock never needs this, because it is read live from MySQL.

### Phase 4 – Learning comments (parallel with 3)

Add a short comment above each logical step in `bot.js`, `chat.js`, `embed.js`, `sync.js`, `config.js` and the new `server.js`. Each says why the step exists and what it does, in Bengali to match the existing style. Keep each to one line.

### Phase 5 – Hardening (parallel)

1. Move the DB credentials, Qdrant URL and model names to `.env`. Right now it is `root` with an empty password.
2. Add rate limiting, an input length cap (for example 300 characters) and a CORS allow-list for your site.
3. Treat user text as untrusted. It goes into the prompt, so keep the "data is the only source of truth" rule and never put secrets in the context.
4. Use a read-only MySQL user.

## Relevant files

- `bot.js`: `SYSTEM`, `retrieve()`, `ask()`, the regexes and `formatContext()`.
- `chat.js`: remove the artificial delay and buffering.
- `embed.js`: `embedTexts()`, cache and `fit()`.
- `sync.js`: collection rebuild and embedded text with aliases.
- `config.js`: environment variables, model names and `keep_alive`.
- `ui/chat-inspector.html`: currently a static mock, not wired to anything.
- `server.js`, `.env` and a widget file are new.

## Verification

1. Measure time to first token and tokens per second before and after Phase 1, using `ollama run qwen2.5:3b --verbose` and a timer around `ask()`.
2. Check these test questions: "আটার দাম কত?", "atar dam koto", "Sugar stock?", the follow-up "এর stock কত?", a greeting, and an unknown product.
3. Check that "Atta" returns both the 1kg and 2kg variants (the margin fix).
4. `curl` the `/chat` SSE endpoint and confirm chunks arrive incrementally. Then confirm the widget works from your website origin and is blocked from other origins.
5. Watch RAM in Task Manager: both models loaded plus MySQL and Qdrant should stay under about 12 GB.

## Decisions

- Stack is Node/Express, v1 scope is stock and price only, input is bn, Banglish and en, and it runs on the same local PC (dev and demo only).
- This PC is fine for development and demos. For real customer traffic, plan a CPU server with a hosted LLM API or a GPU machine, because one CPU-bound model serves one chat at a time.

## Further considerations

1. Template replies vs always using the LLM: template-first is much faster and more accurate for stock numbers. Recommended, with the LLM as fallback.
2. Where `name_bn` and aliases should live: new columns in `products` or a separate alias table. A separate table is safer if you can't change the website schema.
