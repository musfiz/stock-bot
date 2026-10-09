import { qdrant, db, COLLECTION, EMBED_DIM } from './config.js';
import { embedTexts } from './embed.js';

const { exists } = await qdrant.collectionExists(COLLECTION);
if (exists) await qdrant.deleteCollection(COLLECTION);

await qdrant.createCollection(COLLECTION, {
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
  const vectors = await embedTexts(
    batch.map((r) =>
      [r.name, r.category && `category: ${r.category}`, r.description].filter(Boolean).join('. '),
    ),
  );

  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: batch.map((r, j) => ({
      id: Number(r.id),
      vectors: vectors[j],
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

console.log(`${rows.length} টা product sync হয়েছে`);
await db.end();
