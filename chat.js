import readline from 'node:readline';
import { ask } from './bot.js';
import { db } from './config.js';
import { warmup } from './warmup.js';

// চালুর সময় মডেল গরম রাখা, যাতে প্রথম উত্তরে দেরি না হয়।
await warmup().catch((err) => console.error('warmup failed:', err.message));
if (!process.env.OLLAMA_MAX_LOADED_MODELS) {
  console.log('পরামর্শ: OLLAMA_MAX_LOADED_MODELS=2 দিলে দুই মডেল একসাথে RAM-এ থাকবে।');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});

// piped input-এর লাইন queue-তে রাখা, যাতে কোনো লাইন না হারায়।
const pending = [];
const waiting = [];
let closed = false;

rl.on('line', (line) => {
  pending.push(line);
  flush();
});
rl.on('close', () => {
  closed = true;
  flush();
});

function flush() {
  for (const resolve of waiting.splice(0)) {
    resolve(pending.length ? pending.shift() : null);
  }
}

function readLine() {
  if (pending.length) return Promise.resolve(pending.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
}

// CLI session-এর history ও শেষ পণ্য মনে রাখা।
const history = [];
let carryover = [];

console.log(`Inventory bot চালু। বন্ধ করতে ‘exit’ লিখুন।\n`);

try {
  while (true) {
    process.stdout.write('আপনি: ');
    const line = await readLine();
    if (line === null) break;

    const q = line.trim();
    if (!q) continue;
    if (q === 'exit') break;

    process.stdout.write('বুদবুদ: ');
    let reply = '';
    try {
      // chunk এলেই ছাপানো, কোনো কৃত্রিম delay নেই।
      for await (const piece of ask(q, history, {
        carryover,
        onProducts: (p) => {
          carryover = p;
        },
      })) {
        reply += piece;
        process.stdout.write(piece);
      }
    } catch (err) {
      console.error('\nদুঃখিত, উত্তর দিতে সমস্যা হয়েছে:', err.message);
    }
    console.log('\n');

    if (reply) {
      history.push({ role: 'user', content: q });
      history.push({ role: 'assistant', content: reply });
    }
  }
} finally {
  rl.close();
  await db.end();
}
