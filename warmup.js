import ollama from 'ollama';
import { CHAT_MODEL, EMBED_MODEL, KEEP_ALIVE } from './config.js';

// দুই মডেল RAM-এ লোড করে রাখা, যাতে প্রথম প্রশ্নে দেরি না হয়।
export async function warmup() {
  await ollama.embed({ model: EMBED_MODEL, input: 'warmup', keep_alive: KEEP_ALIVE });
  await ollama.chat({
    model: CHAT_MODEL,
    messages: [{ role: 'user', content: 'ok' }],
    stream: false,
    keep_alive: KEEP_ALIVE,
    options: { num_ctx: 2048, num_predict: 5 },
  });
}
