#!/usr/bin/env tsx
/**
 * Quick check for companies in DB
 */

import { openDb, getDb, closeDb } from "@/db";

openDb("data/buiss.db");

const db = getDb();
const companies = db
  .prepare("SELECT id, name_display, normalized_name FROM companies LIMIT 5")
  .all();

console.log("Companies in DB:");
console.log(companies);

closeDb();
