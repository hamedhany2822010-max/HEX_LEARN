require("dotenv").config();

const { neon } = require("@neondatabase/serverless");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL غير موجود في ملف .env");
}

const sql = neon(process.env.DATABASE_URL);

async function initializeDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS answer_cache (
      id BIGSERIAL PRIMARY KEY,
      normalized_question TEXT NOT NULL UNIQUE,
      original_question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      hits INTEGER NOT NULL DEFAULT 0
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS image_cache (
      id BIGSERIAL PRIMARY KEY,
      image_hash TEXT NOT NULL UNIQUE,
      extracted_question TEXT NOT NULL DEFAULT '',
      answer TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      hits INTEGER NOT NULL DEFAULT 0
    )
  `;

  console.log("تم تجهيز جداول Neon بنجاح");
}

module.exports = { sql, initializeDatabase };
