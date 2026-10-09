import 'dotenv/config';
import mysql from 'mysql2/promise';
import { QdrantClient } from '@qdrant/js-client-rest';

// .env থেকে সেটিংস পড়া, না থাকলে ডিফল্ট মান ব্যবহার করা।
export const EMBED_MODEL = process.env.EMBED_MODEL ?? 'bge-m3';
export const CHAT_MODEL = process.env.CHAT_MODEL ?? 'qwen2.5:3b';
export const COLLECTION = process.env.COLLECTION ?? 'products';

// Qdrant collection ও query vector এর width সবসময় এই ভ্যালু হতে হবে।
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 1024);

// Ollama মডেল RAM-এ ধরে রাখার সময়, যাতে প্রতি turn-এ reload না হয়।
export const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? '30m';

// HTTP সার্ভারের পোর্ট ও কোন origin থেকে widget ডাকতে পারবে।
export const PORT = Number(process.env.PORT ?? 3000);
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Qdrant ক্লায়েন্ট তৈরি করা।
export const qdrant = new QdrantClient({ url: process.env.QDRANT_URL ?? 'http://localhost:6333' });

// MySQL connection pool তৈরি করা (শুধু read query চালানো হয়)।
export const db = mysql.createPool({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'grocery',
});
