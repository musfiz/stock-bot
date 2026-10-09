import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { ask, detectLang } from './bot.js';
import { db, PORT, ALLOWED_ORIGINS, CHAT_MODEL, EMBED_MODEL } from './config.js';
import { warmup } from './warmup.js';
import { syncProducts } from './sync.js';

// চালুর সময় মডেল গরম রাখা।
await warmup().catch((err) => console.error('warmup failed:', err.message));

const app = express();
app.use(express.json({ limit: '10kb' }));

// শুধু অনুমোদিত origin থেকে widget ডাকতে পারবে (খালি থাকলে dev-এর জন্য সব)।
if (!ALLOWED_ORIGINS.length) console.log('সতর্কতা: ALLOWED_ORIGINS খালি, সব origin অনুমোদিত (শুধু demo)।');
app.use(
  cors({
    origin: ALLOWED_ORIGINS.length
      ? ALLOWED_ORIGINS
      : true,
  }),
);

// widget ও inspector ফাইল পরিবেশন করা।
app.use(express.static(path.join(process.cwd(), 'ui')));

// অপব্যবহার ঠেকাতে rate limit।
app.use('/chat', rateLimit({ windowMs: 60_000, max: 30 }));
app.use('/admin', rateLimit({ windowMs: 60_000, max: 10 }));

// প্রতি session-এর history সার্ভারে রাখা (browser-এর পাঠানো history বিশ্বাস করা হয় না)।
const sessions = new Map();
const HISTORY_MAX = 8;
function session(id) {
  let s = id && sessions.get(id);
  if (!s) {
    s = { id: id || crypto.randomUUID(), history: [], carryover: [], touched: Date.now() };
    sessions.set(s.id, s);
  }
  s.touched = Date.now();
  return s;
}

// এক ঘণ্টা অব্যবহৃত session মুছে ফেলা।
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.touched > 3_600_000) sessions.delete(id);
  }
}, 600_000);

// মডেল তথ্য দেওয়া (widget/inspector label-এর জন্য)।
app.get('/meta', (req, res) => {
  res.json({ chatModel: CHAT_MODEL, embedModel: EMBED_MODEL });
});

// মূল chat endpoint: stream=true হলে SSE, নাহলে JSON।
app.post('/chat', async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  if (message.length > 300) return res.status(400).json({ error: 'message too long (max 300)' });
  const s = session(String(req.body?.sessionId ?? ''));
  const lang = detectLang(message);
  const wantStream = req.body?.stream !== false;

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    if (!wantStream) {
      let reply = '';
      let products = [];
      for await (const piece of ask(message, s.history, {
        carryover: s.carryover,
        onProducts: (p) => {
          products = p;
        },
        signal: { get aborted() { return aborted; } },
      })) {
        reply += piece;
      }
      s.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
      s.history = s.history.slice(-HISTORY_MAX);
      s.carryover = products;
      return res.json({ reply, sessionId: s.id, debug: debugInfo(products, lang) });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let reply = '';
    let products = [];
    let first = true;
    for await (const piece of ask(message, s.history, {
      carryover: s.carryover,
      onProducts: (p) => {
        products = p;
      },
      signal: { get aborted() { return aborted; } },
    })) {
      if (aborted) break;
      if (first) {
        first = false;
        res.write(`event: debug\ndata: ${JSON.stringify(debugInfo(products, lang))}\n\n`);
      }
      reply += piece;
      res.write(`event: token\ndata: ${JSON.stringify(piece)}\n\n`);
    }
    if (!aborted) {
      s.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
      s.history = s.history.slice(-HISTORY_MAX);
      s.carryover = products;
      res.write(`event: done\ndata: ${JSON.stringify({ sessionId: s.id })}\n\n`);
    }
    res.end();
  } catch (err) {
    console.error('chat failed:', err.message);
    if (!res.headersSent) return res.status(500).json({ error: 'chat failed' });
    res.end();
  }
});

// inspector-এর জন্য debug তথ্য সাজানো।
function debugInfo(products, lang) {
  return {
    lang,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      match: p.match,
      stock_qty: p.stock_qty,
      variations: p.variations.map((v) => ({
        name: v.variation_name,
        sku: v.sku,
        price: v.selling_price,
        stock: v.stock_qty,
      })),
    })),
  };
}

// পণ্য বদলালে admin resync ডাকতে পারবে (stock live পড়া হয়, sync লাগে না)।
app.post('/admin/resync', async (req, res) => {
  if (process.env.ADMIN_TOKEN && req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const n = await syncProducts();
    res.json({ synced: n });
  } catch (err) {
    console.error('resync failed:', err.message);
    res.status(500).json({ error: 'resync failed' });
  }
});

app.listen(PORT, () => console.log(`Chat API চালু: http://localhost:${PORT}`));

process.on('SIGINT', async () => {
  await db.end();
  process.exit(0);
});
