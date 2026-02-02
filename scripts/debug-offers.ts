#!/usr/bin/env tsx
/**
 * Debug script to inspect company offers
 */

import { openDb, getDb, closeDb } from "@/db";

openDb("data/buiss.db");
const db = getDb();

const companyId = parseInt(process.argv[2] || "1", 10);

console.log(`\n=== Offers for Company ${companyId} ===\n`);

// Get offers
const offers = db
  .prepare(
    `
  SELECT 
    o.id, 
    o.title, 
    o.canonical_offer_id,
    o.repost_count,
    o.published_at,
    m.score,
    m.matched_keywords_json
  FROM offers o
  LEFT JOIN matches m ON o.id = m.offer_id
  WHERE o.company_id = ?
`,
  )
  .all(companyId);

console.log(`Total offers: ${offers.length}\n`);

offers.forEach((offer: any) => {
  console.log({
    id: offer.id,
    title: offer.title?.substring(0, 50),
    canonical: offer.canonical_offer_id,
    repostCount: offer.repost_count,
    score: offer.score,
    hasMatch: !!offer.matched_keywords_json,
  });
});

closeDb();
