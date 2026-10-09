import readline from 'node:readline';
import { ask } from './bot.js';
import { db } from './config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});

// readline.question() একবারে একটা মাত্র লাইন নেয়, তাই piped input এ
// বাকি লাইনগুলো হারিয়ে যায়। লাইনগুলো queue তে রেখে একটা একটা করে নিই।
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

const history = [];

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
    let buffer = '';
    try {
      for await (const piece of ask(q, history)) {
        reply += piece;
        buffer += piece;
        const ready = buffer.match(/^[\s\S]*\s/)?.[0];
        if (ready) {
          buffer = buffer.slice(ready.length);
          process.stdout.write(ready);
          await new Promise((r) => setTimeout(r, 30));
        }
      }
      if (buffer) process.stdout.write(buffer);
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