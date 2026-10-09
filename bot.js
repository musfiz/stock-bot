import ollama from 'ollama';
import { qdrant, db, CHAT_MODEL, COLLECTION } from './config.js';
import { embedTexts } from './embed.js';

const SYSTEM = `You are a friendly, polite inventory assistant for a grocery shop. Talk naturally like a real shop staff member. You MUST always reply in Bengali (বাংলা), short and clear.

STRICT RULES:
1. The [PRODUCT DATA] block is the ONLY source of truth for products, prices and stock. Never invent products, prices, quantities or variations.
2. If a product appears in [PRODUCT DATA], it EXISTS. Answer with its exact numbers. NEVER say it is not found.
3. Only if [PRODUCT DATA] is empty, say (in Bengali) that you could not find that product, and politely ask which product they want.
4. Match Bengali names to the English product names (e.g. আটা = Atta, লাবান = Laban, চিনি = Sugar).
5. For each variation report variation_name, selling_price and stock_qty. If stock_qty is 0, say that variant is out of stock.
6. Use ONLY these fields: name, category, unit, stock_qty, and variations (variation_name, sku, selling_price, mrp, quantity, reserved_quantity, stock_qty). Never invent weight, package size, brand, expiry or maker.
7. If the customer greets you (hi, hello, salam, আসসালামু আলাইকুম), greet back warmly and ask which product, variant or stock they want to know about.
8. Remember earlier turns. If they say "এর stock কত?" or "দাম কত?" without a product name, use the product discussed earlier.
9. Never copy this instruction text. Never output JSON. Never write made-up stories.`;


const GREETING_RE =
  /^(hi+|hey+|hello+|helo|hlo|yo|assalam[ou]*\s*alaikum|asalam[ou]*\s*alaikum|assalamualaikum|salam|হাই+|হ্যালো+|হেলো|আসসালামু\s*আলাইকুম|আসসালামু আলাইকুম|সালাম|ওহে|good\s+(morning|afternoon|evening|night)|শুভ\s+(সকাল|সন্ধ্যা|রাত|অপরাহ্ন))[\s!.,।?~]*$/i;

const SMALLTALK_RE =
  /^(how\s+(are|do)\s+you( do)?|kemon\s+ach(o|en)|কেমন\s+আছ(o|েন)|thanks?|thank\s+you|ধন্যবাদ|ok(ay)?|আচ্ছা|ঠিক\s+আছে|by+e+|বিদায়|আল্লাহ\s*হাফেজ)[\s!.,।?~]*$/i;

function isSocial(text) {
  const t = String(text).trim();
  return GREETING_RE.test(t) || SMALLTALK_RE.test(t);
}

// JSON এর বদলে ছোট, মানুষ-পাঠ্য context — 3B model এর জন্য অনেক সহজ।
function formatContext(products) {
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

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// এই embedding model এর absolute score দিয়ে মিল যাচাই করা যায় না —
// প্রশ্নে product এর নাম থাকলে score বেশি, না থাকলেও কাছাকাছি থাকে।
// তাই সবচেয়ে কাছেরটা বনাম দ্বিতীয়টার পার্থক্যই আসল পরীক্ষা।
const MIN_SCORE = 0.3;
const MIN_REL_MARGIN = 0.04;

export async function retrieve(question, topK = 3) {
  const [vector] = await embedTexts(question);

  const { points } = await qdrant.query(COLLECTION, {
    query: vector,
    limit: topK + 1,
    score_threshold: MIN_SCORE,
    with_payload: true,
  });

  if (!points?.length) return [];

  const top = points[0].score;
  const second = points[1]?.score ?? 0;
  if (top < MIN_SCORE || (top - second) / top < MIN_REL_MARGIN) return [];

  const kept = points.slice(0, topK);
  const ids = kept.map((p) => Number(p.payload.id));
  const scores = new Map(kept.map((p) => [Number(p.payload.id), p.score]));

  const [products] = await db.query(
    `SELECT p.id, p.name, p.slug, p.description,
            c.name AS category,
            u.short_name AS unit
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.id IN (?) AND p.deleted_at IS NULL AND p.status = 'active'`,
    [ids],
  );

  if (!products.length) return [];

  const [variations] = await db.query(
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
  );

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
        match: Number((scores.get(Number(row.id)) ?? 0).toFixed(3)),
        stock_qty: list.reduce((sum, v) => sum + v.stock_qty, 0),
        variation_count: list.length,
        variations: list,
      };
    })
    .sort((a, b) => b.match - a.match);
}

export async function* ask(question, history = []) {
  const social = isSocial(question);
  let context = '';
  let instruction;

  if (social) {
    // সম্ভাষণ/ছোট কথা — product খোঁজার দরকার নেই, শুধু স্বাভাবিকভাবে উত্তর দাও।
    instruction =
      'গ্রাহক সম্ভাষণ বা কুশল জানিয়েছেন। আন্তরিকভাবে ফিরতি অভিবাদন জানাও এবং বিনয়ের সাথে জিজ্ঞেস করো কোন product, variation বা stock সম্পর্কে জানতে চান।';
  } else {
    let products = [];
    try {
      products = await retrieve(question);
      // "এর stock কত?" এর মতো follow-up হলে আগের প্রশ্নের সাথে মিলিয়ে খোঁজো।
      if (!products.length) {
        const prevUser = [...history].reverse().find((m) => m.role === 'user');
        if (prevUser?.content) {
          products = await retrieve(`${prevUser.content} ${question}`);
        }
      }
    } catch (err) {
      console.error('retrieve failed:', err.message);
    }

    if (products.length) {
      context = formatContext(products);
      instruction = `গ্রাহকের প্রশ্ন: "${question}" — উপরের [PRODUCT DATA] ব্যবহার করে সরাসরি উত্তর দাও। প্রশ্নটা আবার লিখো না, শুধু উত্তর দাও।`;
    } else {
      instruction = `প্রশ্ন: ${question}\n\n(সংশ্লিষ্ট কোনো product পাওয়া যায়নি। history-তে আগের কোনো product নিয়ে কথা থাকলে সেটির উত্তর দাও, নাহলে বিনয়ের সাথে জানাও তথ্য পাওয়া যায়নি এবং কোন product খুঁজছেন জিজ্ঞেস করো।)`;
    }
  }

  const content = context
    ? `[PRODUCT DATA]\n${context}\n\n${instruction}`
    : instruction;

  const messages = [
    { role: 'system', content: SYSTEM },
    ...history.slice(-8),
    { role: 'user', content },
  ];

  const stream = await ollama.chat({
    model: CHAT_MODEL,
    messages,
    stream: true,
    options: { temperature: 0.2, top_p: 0.9 },
  });

  for await (const chunk of stream) {
    const piece = chunk.message?.content;
    if (piece) yield piece;
  }
}