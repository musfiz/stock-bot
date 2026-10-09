import ollama from 'ollama';
import { EMBED_MODEL, EMBED_DIM, KEEP_ALIVE } from './config.js';

// একই প্রশ্ন বারবার embed না করতে ছোট in-memory cache।
const cache = new Map();
const CACHE_MAX = 200;

// vector-এর width ঠিক আছে কিনা যাচাই করা (চুপচাপ কাটা যাবে না)।
function fit(vec) {
  if (vec.length !== EMBED_DIM) {
    throw new Error(
      `embedding ${vec.length} ডাইমেনশনের, প্রয়োজন ${EMBED_DIM} — EMBED_MODEL এর সাথে EMBED_DIM মেলাতে হবে`,
    );
  }
  return vec;
}

// cache key বানাতে text normalize করা।
function norm(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, ' ');
}

// এক বা একাধিক text-এর embedding বের করা (cache সহ)।
export async function embedTexts(input) {
  const list = Array.isArray(input) ? input : [input];
  const out = new Array(list.length);
  const missing = [];
  const missingIdx = [];
  for (let i = 0; i < list.length; i++) {
    const hit = cache.get(norm(list[i]));
    if (hit) out[i] = hit;
    else {
      missing.push(list[i]);
      missingIdx.push(i);
    }
  }
  if (missing.length) {
    const { embeddings } = await ollama.embed({
      model: EMBED_MODEL,
      input: missing,
      truncate: true,
      keep_alive: KEEP_ALIVE,
    });
    if (embeddings?.length !== missing.length) throw new Error('embedding ফাঁকা এসেছে');
    for (let k = 0; k < missing.length; k++) {
      const vec = fit(embeddings[k]);
      out[missingIdx[k]] = vec;
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(norm(missing[k]), vec);
    }
  }
  return out;
}
