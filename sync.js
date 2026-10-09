import { qdrant, db, COLLECTION, EMBED_DIM } from './config.js';
import { embedTexts } from './embed.js';
import { aliasesFor } from './aliases.js';

// পুরো sync এক ফাংশনে, যাতে admin endpoint থেকেও ডাকা যায়।
export async function syncProducts() {
  // নতুন collection-এ লিখে শেষে swap করা, যাতে মাঝপথে search বন্ধ না হয়।
  const fresh = `${COLLECTION}__${Date.now()}`;
  await qdrant.createCollection(fresh, {
    vectors: { size: EMBED_DIM, distance: 'Cosine' },
  });
  const [rows] = await db.query(
    `SELECT p.id, p.name, p.slug, p.description,
            c.name AS category,
            GROUP_CONCAT(DISTINCT v.sku ORDER BY v.sku SEPARATOR ', ') AS skus
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_variations v
              ON v.product_id = p.id AND v.deleted_at IS NULL AND v.is_active = 1
      WHERE p.deleted_at IS NULL AND p.status = 'active'
      GROUP BY p.id, p.name, p.slug, p.description, c.name
      ORDER BY p.id`,
  );
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // নামের সাথে উপনামও embed করা, যাতে Banglish প্রশ্ন মেলে।
    const vectors = await embedTexts(
      batch.map((r) =>
        [r.name, aliasesFor(r.name).join(' '), r.category && `category: ${r.category}`, r.description]
          .filter(Boolean)
          .join('. '),
      ),
    );
    await qdrant.upsert(fresh, {
      wait: true,
      points: batch.map((r, j) => ({
        id: Number(r.id),
        vector: vectors[j],
        payload: {
          id: Number(r.id),
          name: r.name,
          slug: r.slug,
          category: r.category ?? null,
          skus: r.skus ?? null,
        },
      })),
    });
    console.log(`${Math.min(i + BATCH, rows.length)} / ${rows.length} synced`);
  }
  // alias এক ধাপে নতুন collection-এ ঘোরানো (search বন্ধ না করেই)।
  try {
    await qdrant.updateCollectionAliases({ actions: [{ delete_alias: { alias_name: COLLECTION } }] });
  } catch {
    /* পুরনো alias নেই, এগিয়ে যাওয়া */
  }
  // প্রথম migration-এ COLLECTION নামে আসল collection থাকলে সরানো।
  try {
    const { exists } = await qdrant.collectionExists(COLLECTION);
    if (exists) await qdrant.deleteCollection(COLLECTION);
  } catch {
    /* alias নামে exists ফেল করতে পারে, সমস্যা নেই */
  }
  await qdrant.updateCollectionAliases({
    actions: [{ create_alias: { collection_name: fresh, alias_name: COLLECTION } }],
  });
  // আগের timestamp collection গুলো মুছে ফেলা।
  try {
    const { collections } = await qdrant.getCollections();
    for (const c of collections ?? []) {
      if (c.name.startsWith(`${COLLECTION}__`) && c.name !== fresh) {
        await qdrant.deleteCollection(c.name);
      }
    }
  } catch {
    /* cleanup ফেল হলেও sync সফল */
  }
  return rows.length;
}

// CLI থেকে চালালে সরাসরি sync করা।
const isCli = process.argv[1]?.endsWith('sync.js');
if (isCli) {
  const n = await syncProducts();
  console.log(`${n} টা product sync হয়েছে`);
  await db.end();
}
