/**
 * downloadBible.cjs — Download and convert full KJV Bible to our JSON format
 *
 * Source: thiagobodruk/bible (GitHub, public domain KJV)
 * Format: Array of { abbrev, name, chapters: string[][] }
 *   → Our format: { "Genesis": { "1": { "1": "text", "2": "text", ... }, ... }, ... }
 *
 * Run: node scripts/downloadBible.cjs
 */

const fs = require("fs");
const path = require("path");

const OUTPUT = path.join(__dirname, "..", "public", "bible-kjv.json");
const SOURCE_URL =
  "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json";

// Our canonical book names (must match types.ts BIBLE_BOOKS)
const CANONICAL_NAMES = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles",
  "Ezra", "Nehemiah", "Esther", "Job",
  "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
  "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah",
  "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon",
  "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John",
  "Jude", "Revelation",
];

/**
 * Clean up verse text — remove inline study notes like {text} and trim whitespace
 */
function cleanVerseText(text) {
  // Remove curly-brace study notes/annotations: {something}
  return text.replace(/\{[^}]*\}/g, "").replace(/\s{2,}/g, " ").trim();
}

async function main() {
  console.log("Downloading full KJV Bible from GitHub...");
  console.log(`Source: ${SOURCE_URL}\n`);

  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }

  const sourceData = await res.json();
  console.log(`Downloaded ${sourceData.length} books from source.`);

  if (sourceData.length !== 66) {
    console.warn(`Warning: Expected 66 books, got ${sourceData.length}`);
  }

  const bible = {};
  let totalVerses = 0;
  let totalChapters = 0;

  for (let i = 0; i < sourceData.length; i++) {
    const book = sourceData[i];
    const canonicalName = CANONICAL_NAMES[i];

    if (!canonicalName) {
      console.warn(`  Skipping unknown book index ${i}: ${book.name || book.abbrev}`);
      continue;
    }

    bible[canonicalName] = {};

    for (let ch = 0; ch < book.chapters.length; ch++) {
      const chapterNum = String(ch + 1);
      const verses = book.chapters[ch];
      bible[canonicalName][chapterNum] = {};

      for (let v = 0; v < verses.length; v++) {
        const verseNum = String(v + 1);
        const cleanText = cleanVerseText(verses[v]);
        if (cleanText) {
          bible[canonicalName][chapterNum][verseNum] = cleanText;
          totalVerses++;
        }
      }
      totalChapters++;
    }

    console.log(
      `  ${canonicalName}: ${book.chapters.length} chapters`
    );
  }

  // Write the output
  fs.writeFileSync(OUTPUT, JSON.stringify(bible), "utf-8");
  const sizeMB = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);

  console.log(`\n✅ Done!`);
  console.log(`   Books: ${Object.keys(bible).length}`);
  console.log(`   Chapters: ${totalChapters}`);
  console.log(`   Verses: ${totalVerses}`);
  console.log(`   Size: ${sizeMB} MB`);
  console.log(`   Output: ${OUTPUT}`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
