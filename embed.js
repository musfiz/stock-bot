import ollama from 'ollama';
import { EMBED_MODEL, EMBED_DIM } from './config.js';

function fit(vec) {
  if (vec.length === EMBED_DIM) return vec;
  if (vec.length > EMBED_DIM) return vec.slice(0, EMBED_DIM);
  throw new Error(
    `embedding মাত্র ${vec.length} ডাইমেনশনের, প্রয়োজন ${EMBED_DIM} — EMBED_MODEL এর সাথে EMBED_DIM মেলাতে হবে`,
  );
}

export async function embedTexts(input) {
  const { embeddings } = await ollama.embed({
    model: EMBED_MODEL,
    input,
    truncate: true,
  });

  if (!embeddings?.length) throw new Error('embedding ফাঁকা এসেছে');

  const vectors = embeddings.map(fit);
  const expected = Array.isArray(input) ? input.length : 1;
  if (vectors.length !== expected) {
    throw new Error(
      `embedding ${vectors.length} টা এসেছে, প্রয়োজন ${expected} টা`,
    );
  }
  return vectors;
}
