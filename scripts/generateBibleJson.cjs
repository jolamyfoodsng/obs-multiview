/**
 * generateBibleJson.cjs — Script to generate bible-kjv.json from a public domain source
 *
 * Run: node scripts/generateBibleJson.cjs
 *
 * This fetches the KJV text from a public domain API and writes it as:
 * { "Genesis": { "1": { "1": "In the beginning...", ... }, ... }, ... }
 *
 * If the fetch fails, it creates a minimal sample for development.
 */

const fs = require("fs");
const path = require("path");

const OUTPUT = path.join(__dirname, "..", "public", "bible-kjv.json");

const BOOKS = [
  { name: "Genesis", chapters: 50 },
  { name: "Exodus", chapters: 40 },
  { name: "Leviticus", chapters: 27 },
  { name: "Numbers", chapters: 36 },
  { name: "Deuteronomy", chapters: 34 },
  { name: "Joshua", chapters: 24 },
  { name: "Judges", chapters: 21 },
  { name: "Ruth", chapters: 4 },
  { name: "1 Samuel", chapters: 31 },
  { name: "2 Samuel", chapters: 24 },
  { name: "1 Kings", chapters: 22 },
  { name: "2 Kings", chapters: 25 },
  { name: "1 Chronicles", chapters: 29 },
  { name: "2 Chronicles", chapters: 36 },
  { name: "Ezra", chapters: 10 },
  { name: "Nehemiah", chapters: 13 },
  { name: "Esther", chapters: 10 },
  { name: "Job", chapters: 42 },
  { name: "Psalms", chapters: 150 },
  { name: "Proverbs", chapters: 31 },
  { name: "Ecclesiastes", chapters: 12 },
  { name: "Song of Solomon", chapters: 8 },
  { name: "Isaiah", chapters: 66 },
  { name: "Jeremiah", chapters: 52 },
  { name: "Lamentations", chapters: 5 },
  { name: "Ezekiel", chapters: 48 },
  { name: "Daniel", chapters: 12 },
  { name: "Hosea", chapters: 14 },
  { name: "Joel", chapters: 3 },
  { name: "Amos", chapters: 9 },
  { name: "Obadiah", chapters: 1 },
  { name: "Jonah", chapters: 4 },
  { name: "Micah", chapters: 7 },
  { name: "Nahum", chapters: 3 },
  { name: "Habakkuk", chapters: 3 },
  { name: "Zephaniah", chapters: 3 },
  { name: "Haggai", chapters: 2 },
  { name: "Zechariah", chapters: 14 },
  { name: "Malachi", chapters: 4 },
  { name: "Matthew", chapters: 28 },
  { name: "Mark", chapters: 16 },
  { name: "Luke", chapters: 24 },
  { name: "John", chapters: 21 },
  { name: "Acts", chapters: 28 },
  { name: "Romans", chapters: 16 },
  { name: "1 Corinthians", chapters: 16 },
  { name: "2 Corinthians", chapters: 13 },
  { name: "Galatians", chapters: 6 },
  { name: "Ephesians", chapters: 6 },
  { name: "Philippians", chapters: 4 },
  { name: "Colossians", chapters: 4 },
  { name: "1 Thessalonians", chapters: 5 },
  { name: "2 Thessalonians", chapters: 3 },
  { name: "1 Timothy", chapters: 6 },
  { name: "2 Timothy", chapters: 4 },
  { name: "Titus", chapters: 3 },
  { name: "Philemon", chapters: 1 },
  { name: "Hebrews", chapters: 13 },
  { name: "James", chapters: 5 },
  { name: "1 Peter", chapters: 5 },
  { name: "2 Peter", chapters: 3 },
  { name: "1 John", chapters: 5 },
  { name: "2 John", chapters: 1 },
  { name: "3 John", chapters: 1 },
  { name: "Jude", chapters: 1 },
  { name: "Revelation", chapters: 22 },
];

// API book name → our canonical name mapping for the free API
const API_BOOK_MAP = {};
BOOKS.forEach((b) => {
  // The bible-api.com uses lowercase, no spaces for numbered books
  let apiName = b.name.toLowerCase().replace(/ /g, "+");
  API_BOOK_MAP[b.name] = apiName;
});

async function fetchChapter(book, chapter) {
  const bookSlug = book.toLowerCase().replace(/ /g, "%20");
  const url = `https://bible-api.com/${encodeURIComponent(book)}+${chapter}?translation=kjv`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.verses) return null;
    const chapterData = {};
    for (const v of data.verses) {
      chapterData[String(v.verse)] = v.text.trim();
    }
    return chapterData;
  } catch {
    return null;
  }
}

async function main() {
  console.log("Generating bible-kjv.json ...");
  console.log("This will fetch from bible-api.com (public domain KJV).");
  console.log("This may take a while for the full Bible.\n");

  const bible = {};
  let totalVerses = 0;

  for (const { name, chapters } of BOOKS) {
    bible[name] = {};
    process.stdout.write(`  ${name} ...`);

    for (let ch = 1; ch <= chapters; ch++) {
      const chData = await fetchChapter(name, ch);
      if (chData) {
        bible[name][String(ch)] = chData;
        totalVerses += Object.keys(chData).length;
      } else {
        // Mark as empty so we know it failed
        bible[name][String(ch)] = {};
      }
      // Small delay to be polite to the API
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log(` ${chapters} chapters`);
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(bible), "utf-8");
  const sizeMB = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
  console.log(`\nDone! ${totalVerses} verses, ${sizeMB} MB → ${OUTPUT}`);
}

main().catch(console.error);
