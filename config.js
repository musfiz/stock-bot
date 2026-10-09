import mysql from 'mysql2/promise';
import { QdrantClient } from '@qdrant/js-client-rest';

export const EMBED_MODEL = 'bge-m3';
export const CHAT_MODEL = 'qwen2.5:3b';
export const COLLECTION = 'products';

// Qdrant collection ও query vector এর width সবসময় এই ভ্যালু হতে হবে।
// model বদলালে এটাও বদলাতে হবে, তাই এখানেই এক জায়গায় রাখা হলো।
export const EMBED_DIM = 1024;

export const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

export const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'grocery',
});
