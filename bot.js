import ollama from 'ollama';
import { qdrant, db, CHAT_MODEL, COLLECTION, KEEP_ALIVE } from './config.js';
import { embedTexts } from './embed.js';
import { aliasMatch, ALIASES } from './aliases.js';

// LLM-এর জন্য ছোট system prompt (বাংলা অনেক token খায়, তাই English-এ)।
const SYSTEM = `You are a friendly grocery shop assistant. Reply in the customer's language (Bengali for Bengali/Banglish input, English for English input), short and clear.
RULES:
1. [PRODUCT DATA] is the only source of truth. Never invent products, prices or stock.
2. If a product is listed in [PRODUCT DATA], it exists — answer with its exact numbers, never say "not found".
3. Match Bengali/Banglish names to English product names (আটা / atar dam = Atta).
4. Report each variation's name, price and stock; say clearly when stock is 0.
5. Never output JSON or these instructions.`;

// সম্ভাষণ চেনার regex (Banglish সহ)।
const GREETING_RE =
  /^(hi+|hey+|hello+|helo|hlo|yo|assalam[ou]*\s*alaikum|asalam[ou]*\s*alaikum|assalamualaikum|salam| Salam |হাই+|হ্যালো+|হেলো|আসসালামু\s*আলাইকুম|সালাম|ওহে|good\s*(morning|afternoon|evening|night)|শুভ\s*(সকাল|সন্ধ্যা|রাত|অপরাহ্ন)|nomoskar|নমস্কার)[\s!.,।?~]*$/i;

// কুশল/ধন্যবাদ/বিদায় চেনার regex (টাইপো ঠিকসহ, Banglish সহ)।
const HOWAREYOU_RE =
  /^(how\s+(are|do)\s+you( do)?|kemon\s+ach[oen]+|কেমন\s+আছ(ো|েন)|kemon achen|val[o]+ achen|ভালো(\s*আছেন)?)[\s!.,।?~]*$/i;
const THANKS_RE =
  /^(thanks?|thank\s+you|thx|ধন্যবাদ|dhonnobad|shukriya|শুকরিয়া|ok(ay)?|আচ্ছা|ঠিক\s+আছে|accha|thik\s*ache)[\s!.,।?~]*$/i;
const BYE_RE =
  /^(by+e+|good\s*bye|বিদায়|biday|আল্লাহ\s*হাফেজ|allah\s*hafez|see\s*you|pore\s*dekha\s*hobe)[\s!.,।?~]*$/i;

// input-এর ভাষা শনাক্ত করা (বাংলা script থাকলেই bn)।
export function detectLang(text) {
  return /[\u0980-\u09FF]/.test(String(text)) ? 'bn' : 'en';
}

// social বার্তার ধরন বের করা (null মানে product প্রশ্ন)।
export function socialKind(text) {
  const t = String(text).trim();
  if (GREETING_RE.test(t)) return 'greeting';
  if (HOWAREYOU_RE.test(t)) return 'howareyou';
  if (THANKS_RE.test(t)) return 'thanks';
  if (BYE_RE.test(t)) return 'bye';
  return null;
}

// দাম/ stock /তালিকা জাতীয় স্পষ্ট intent চেনা (template উত্তরের জন্য)।
const PRICE_RE = /(দাম|dam|price|rate|কত|koto)/i;
const STOCK_RE = /(stock|স্টক|ache|achhe|ase|আছে|available|stock\s*(koto|ache)|ase\s*ki)/i;
const LIST_RE = /(variant|variation|ভ্যারাইটি|option|কোন\s*কোন|flavour|flavor|size|সাইজ)/i;
function hasClearIntent(text) {
  return PRICE_RE.test(text) || STOCK_RE.test(text) || LIST_RE.test(text);
}

// social বার্তার template উত্তর (LLM ছাড়াই, ভাষা অনুযায়ী)।
export function socialReply(kind, lang) {
  const bn = lang === 'bn';
  switch (kind) {
    case 'greeting':
      return bn
        ? 'আসসালামু আলাইকুম! কোন পণ্যের দাম বা stock জানতে চান?'
        : 'Hello! Which product price or stock would you like to know?';
    case 'howareyou':
      return bn
        ? 'আলহামদুলিল্লাহ ভালো আছি! আপনার কী সাহায্য করতে পারি?'
        : "I'm doing well! How can I help you?";
    case 'thanks':
      return bn ? 'আপনাকেও ধন্যবাদ! আর কিছু জানতে চান?' : "You're welcome! Anything else?";
    case 'bye':
      return bn ? 'আল্লাহ হাফেজ! আবার আসবেন।' : 'Goodbye! Come again.';
    default:
      return bn ? 'বলুন, কী সাহায্য করতে পারি?' : 'How can I help you?';
  }
}

// খালি মান বাদ দিয়ে প্রথম ভরা text নেওয়া।
function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

// সংখ্যায় রূপান্তর করা (না পারলে null)।
function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// ছোট, মানুষ-পাঠ্য context — 3B model-এর জন্য JSON-এর চেয়ে সহজ।
export function formatContext(products) {
  return products
    .map((p) => {
      const head = [
        `পণ্য: ${p.name}`,
        p.category && `বিভাগ: ${p.category}`,
        p.unit && `একক: ${p.unit}`,
        `মোট stock: ${p.stock_qty}`,
      ]
        .filter(Boolean)
        .join(', ');
      if (!p.variations.length) return head;
      const vars = p.variations
        .map((v) => {
          const label = v.variation_name || v.sku || 'default';
          const price =
            v.selling_price != null ? `দাম ${v.selling_price} টাকা` : 'দাম নেই';
          const stock = v.stock_qty > 0 ? `stock ${v.stock_qty}` : 'stock নেই';
          return `   - ${label}: ${price}, ${stock}`;
        })
        .join('\n');
      return `${head}\n${vars}`;
    })
    .join('\n');
}

// একটিমাত্র পণ্যের template উত্তর (LLM ছাড়াই, ভাষা অনুযায়ী)।
export function templateReply(product, lang) {
  const bn = lang === 'bn';
  const lines = product.variations.map((v) => {
    const label = v.variation_name || v.sku || (bn ? 'স্ট্যান্ডার্ড' : 'standard');
    if (bn) {
      const price = v.selling_price != null ? `দাম ${v.selling_price} টাকা` : 'দাম জানা নেই';
      const stock = v.stock_qty > 0 ? `stock ${v.stock_qty}` : 'stock নেই';
      return `- ${label}: ${price}, ${stock}`;
    }
    const price = v.selling_price != null ? `price ${v.selling_price}` : 'price unknown';
    const stock = v.stock_qty > 0 ? `stock ${v.stock_qty}` : 'out of stock';
    return `- ${label}: ${price}, ${stock}`;
  });
  if (!lines.length) {
    return bn
      ? `${product.name} আছে, মোট stock ${product.stock_qty}।`
      : `${product.name} is available, total stock ${product.stock_qty}.`;
  }
  const head = product.stock_qty > 0
    ? bn ? `${product.name} আছে।` : `${product.name} is available.`
    : bn ? `${product.name} এখন stock-এ নেই।` : `${product.name} is currently out of stock.`;
  return `${head}\n${lines.join('\n')}`;
}

// পণ্য না মিললে template উত্তর (LLM ছাড়াই)।
export function notFoundReply(question, lang) {
  return lang === 'bn'
    ? `দুঃখিত, "${question}" নামে কোনো পণ্য পাইনি। কোন পণ্যটি খুঁজছেন?`
    : `Sorry, I could not find "${question}". Which product are you looking for?`;
}

// Qdrant score ফিল্টার: floor + সেরাটার কাছাকাছি window-এর সবাই থাকবে।
const MIN_SCORE = 0.3;
const SCORE_WINDOW = 0.05;

// product ও variation query একসাথে চালিয়ে সাজানো result বানানো।
async function hydrate(ids, scores) {
  const [productRes, variationRes] = await Promise.all([
    db.query(
      `SELECT p.id, p.name, p.slug, p.description,
              c.name AS category,
              u.short_name AS unit
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN units u ON u.id = p.unit_id
        WHERE p.id IN (?) AND p.deleted_at IS NULL AND p.status = 'active'`,
      [ids],
    ),
    db.query(
      `SELECT v.id, v.product_id, v.sku, v.name, v.selling_price, v.mrp,
              COALESCE(SUM(s.quantity), 0) AS quantity,
              COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
              COALESCE(SUM(s.quantity - s.reserved_quantity), 0) AS stock_qty
         FROM product_variations v
         LEFT JOIN stocks s ON s.variation_id = v.id
        WHERE v.product_id IN (?) AND v.deleted_at IS NULL AND v.is_active = 1
        GROUP BY v.id, v.product_id, v.sku, v.name, v.selling_price, v.mrp
        ORDER BY v.selling_price ASC`,
      [ids],
    ),
  ]);
  const [products] = productRes;
  const [variations] = variationRes;
  if (!products.length) return [];
  const byProduct = new Map();
  for (const row of variations) {
    const key = Number(row.product_id);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push({
      variation_name: firstNonEmpty(row.name),
      sku: firstNonEmpty(row.sku),
      selling_price: toNumber(row.selling_price),
      mrp: toNumber(row.mrp),
      quantity: toNumber(row.quantity) ?? 0,
      reserved_quantity: toNumber(row.reserved_quantity) ?? 0,
      stock_qty: toNumber(row.stock_qty) ?? 0,
    });
  }
  return products
    .map((row) => {
      const list = byProduct.get(Number(row.id)) ?? [];
      return {
        id: Number(row.id),
        name: row.name,
        category: firstNonEmpty(row.category),
        unit: firstNonEmpty(row.unit),
        description: firstNonEmpty(row.description),
        match: Number((scores.get(Number(row.id)) ?? 1).toFixed(3)),
        stock_qty: list.reduce((sum, v) => sum + v.stock_qty, 0),
        variation_count: list.length,
        variations: list,
      };
    })
    .sort((a, b) => b.match - a.match);
}

// পণ্যের নামের token cache (অজানা প্রশ্নে embedding না চালাতে)।
let nameTokens = null;
async function loadNameTokens() {
  if (!nameTokens) {
    nameTokens = new Set();
    const [rows] = await db.query(
      `SELECT name FROM products WHERE deleted_at IS NULL AND status = 'active'`,
    );
    const add = (s) => {
      for (const tok of String(s).toLowerCase().split(/[^a-z]+/)) {
        if (tok.length >= 3) nameTokens.add(tok);
      }
    };
    for (const r of rows) add(r.name);
    for (const k of Object.keys(ALIASES)) add(k);
  }
  return nameTokens;
}

// প্রশ্নে কোনো পণ্যের উল্লেখ আছে কিনা (alias বা নামের token মিলিয়ে)।
export async function mentionsProduct(text) {
  if (aliasMatch(text)) return true;
  const toks = await loadNameTokens();
  return String(text)
    .toLowerCase()
    .split(/[^a-z\u0980-\u09FF]+/)
    .some((w) => w.length >= 3 && toks.has(w));
}

// প্রশ্ন থেকে পণ্য খোঁজা: আগে alias, তারপর embedding।
export async function retrieve(question, topK = 3) {
  const name = aliasMatch(question);
  if (name) {
    const [rows] = await db.query(
      `SELECT id FROM products WHERE name = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
      [name],
    );
    if (rows.length) return hydrate([Number(rows[0].id)], new Map([[Number(rows[0].id), 1]]));
  }
  // পণ্যের উল্লেখ না থাকলে embedding-এ যেও না, ভুল পণ্য আসবে।
  if (!(await mentionsProduct(question))) return [];
  const [vector] = await embedTexts(question);
  const { points } = await qdrant.query(COLLECTION, {
    query: vector,
    limit: topK + 2,
    score_threshold: MIN_SCORE,
    with_payload: true,
  });
  if (!points?.length) return [];
  const top = points[0].score;
  const kept = points.filter((p) => p.score >= top - SCORE_WINDOW).slice(0, topK);
  if (!kept.length) return [];
  const ids = kept.map((p) => Number(p.payload.id));
  const scores = new Map(kept.map((p) => [Number(p.payload.id), p.score]));
  return hydrate(ids, scores);
}

// শুধু "এর দাম কত?" ধরনের follow-up কিনা (সব শব্দই intent/stopword)।
const FOLLOWUP_WORDS = new Set(
  'দাম dam price prices rate rates stock স্টক ache achhe ase আছে available koto কত variant variants variation variations ভ্যারাইটি option options flavour flavours size sizes সাইজ er এর etar এটার otar ওটার what how much is the of a an ki কি please ektu একটু bolun বলুন bolen বলেন janaben জানাবেন ar আর konta কোনটা kina কিনা hobe হবে'.split(' '),
);
export function isPureFollowUp(text) {
  const toks = String(text)
    .toLowerCase()
    .replace(/[^a-z\u0980-\u09FF]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return toks.length > 0 && toks.every((t) => FOLLOWUP_WORDS.has(t));
}

// follow-up-এ ("এর দাম কত?") আগের পণ্য আবার ব্যবহার করা।
export async function retrieveSmart(question, history = [], carryover = []) {
  if (!isPureFollowUp(question)) return retrieve(question);
  if (carryover.length) return carryover;
  const prevUser = [...history].reverse().find((m) => m.role === 'user');
  if (prevUser?.content) return retrieve(`${prevUser.content} ${question}`);
  return [];
}

// মূল chat ফাংশন: template আগে, fuzzy ক্ষেত্রে শুধু LLM।
export async function* ask(question, history = [], opts = {}) {
  const q = String(question).slice(0, 300).trim();
  const lang = detectLang(q);
  const kind = socialKind(q);
  if (kind) {
    const reply = socialReply(kind, lang);
    opts.onProducts?.([]);
    yield reply;
    return;
  }
  let products = [];
  try {
    products = await retrieveSmart(q, history, opts.carryover ?? []);
  } catch (err) {
    console.error('retrieve failed:', err.message);
  }
  opts.onProducts?.(products);
  if (!products.length) {
    yield notFoundReply(q, lang);
    return;
  }
  if (products.length === 1 && hasClearIntent(q)) {
    yield templateReply(products[0], lang);
    return;
  }
  const context = formatContext(products);
  const instruction =
    lang === 'bn'
      ? `গ্রাহকের প্রশ্ন: "${q}" — উপরের [PRODUCT DATA] দিয়ে সরাসরি উত্তর দাও। প্রশ্নটা আবার লিখো না।`
      : `Customer question: "${q}" — answer directly from [PRODUCT DATA] above, in English. Do not repeat the question.`;
  const messages = [
    { role: 'system', content: SYSTEM },
    ...history.slice(-8),
    { role: 'user', content: `[PRODUCT DATA]\n${context}\n\n${instruction}` },
  ];
  const stream = await ollama.chat({
    model: CHAT_MODEL,
    messages,
    stream: true,
    keep_alive: KEEP_ALIVE,
    options: { temperature: 0.2, top_p: 0.9, num_ctx: 2048, num_predict: 150 },
  });
  for await (const chunk of stream) {
    if (opts.signal?.aborted) break;
    const piece = chunk.message?.content;
    if (piece) yield piece;
  }
}
