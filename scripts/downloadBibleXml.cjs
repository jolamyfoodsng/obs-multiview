/**
 * downloadBibleXml.cjs — Download and convert Beblia XML Bible translations
 *
 * Usage:
 *   node scripts/downloadBibleXml.cjs [language-file-name]
 *
 * Examples:
 *   node scripts/downloadBibleXml.cjs EnglishKJBible       # KJV
 *   node scripts/downloadBibleXml.cjs EnglishNIVBible       # NIV
 *   node scripts/downloadBibleXml.cjs EnglishESVBible       # ESV
 *   node scripts/downloadBibleXml.cjs EnglishNLTBible       # NLT
 *   node scripts/downloadBibleXml.cjs EnglishNASBBible      # NASB
 *   node scripts/downloadBibleXml.cjs --list                # List available English versions
 *
 * Source: https://github.com/Beblia/Holy-Bible-XML-Format
 * XML format: <bible translation="..."><testament name="Old|New"><book number="N"><chapter number="N"><verse number="N">text</verse>
 *
 * Output: public/bible-{id}.json in the same JSON format as bible-kjv.json:
 *   { "Genesis": { "1": { "1": "In the beginning...", "2": "..." }, ... }, ... }
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// Book number → canonical name mapping (Beblia uses 1-66 numbering)
const BOOK_MAP = {
  // Old Testament
  1: "Genesis", 2: "Exodus", 3: "Leviticus", 4: "Numbers", 5: "Deuteronomy",
  6: "Joshua", 7: "Judges", 8: "Ruth", 9: "1 Samuel", 10: "2 Samuel",
  11: "1 Kings", 12: "2 Kings", 13: "1 Chronicles", 14: "2 Chronicles",
  15: "Ezra", 16: "Nehemiah", 17: "Esther", 18: "Job", 19: "Psalms", 20: "Proverbs",
  21: "Ecclesiastes", 22: "Song of Solomon", 23: "Isaiah", 24: "Jeremiah",
  25: "Lamentations", 26: "Ezekiel", 27: "Daniel", 28: "Hosea", 29: "Joel",
  30: "Amos", 31: "Obadiah", 32: "Jonah", 33: "Micah", 34: "Nahum",
  35: "Habakkuk", 36: "Zephaniah", 37: "Haggai", 38: "Zechariah", 39: "Malachi",
  // New Testament
  40: "Matthew", 41: "Mark", 42: "Luke", 43: "John", 44: "Acts",
  45: "Romans", 46: "1 Corinthians", 47: "2 Corinthians", 48: "Galatians",
  49: "Ephesians", 50: "Philippians", 51: "Colossians",
  52: "1 Thessalonians", 53: "2 Thessalonians",
  54: "1 Timothy", 55: "2 Timothy", 56: "Titus", 57: "Philemon",
  58: "Hebrews", 59: "James", 60: "1 Peter", 61: "2 Peter",
  62: "1 John", 63: "2 John", 64: "3 John", 65: "Jude", 66: "Revelation",
};

// Known English Bible versions from the Beblia repo
const KNOWN_ENGLISH = {
  EnglishKJBible: "kjv",
  EnglishASVBible: "asv",
  EnglishWEBBible: "web",
  EnglishNKJBible: "nkjv",
  EnglishNIVBible: "niv",
  EnglishESVBible: "esv",
  EnglishNASBBible: "nasb",
  EnglishNLTBible: "nlt",
  EnglishCSBBible: "csb",
  EnglishNRSVBible: "nrsv",
  EnglishMEVBible: "mev",
  EnglishNETBible: "net",
  EnglishGNTBible: "gnt",
  EnglishERVBible: "erv",
  EnglishYLTBible: "ylt",
  EnglishDarbyBible: "darby",
  EnglishAmplifiedBible: "amp",
  EnglishLSBBible: "lsb",
  EnglishBereanBible: "bsb",
  EnglishPassionBible: "tpt",
  EnglishRSVBible: "rsv",
};

const BASE_URL = "https://raw.githubusercontent.com/Beblia/Holy-Bible-XML-Format/master";

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Parse Beblia XML into our JSON format.
 * XML structure: <bible><testament><book number="N"><chapter number="N"><verse number="N">text</verse>
 *
 * Uses simple regex parsing (no XML library needed) since the format is very consistent.
 */
function parseBebliaXml(xml) {
  const result = {};

  // Match all <book> elements
  const bookRegex = /<book\s+number="(\d+)">([\s\S]*?)<\/book>/g;
  let bookMatch;

  while ((bookMatch = bookRegex.exec(xml)) !== null) {
    const bookNum = parseInt(bookMatch[1], 10);
    const bookName = BOOK_MAP[bookNum];
    if (!bookName) {
      console.warn(`Unknown book number: ${bookNum}`);
      continue;
    }
    result[bookName] = {};

    // Match all <chapter> elements within this book
    const chapterRegex = /<chapter\s+number="(\d+)">([\s\S]*?)<\/chapter>/g;
    const bookContent = bookMatch[2];
    let chapMatch;

    while ((chapMatch = chapterRegex.exec(bookContent)) !== null) {
      const chapNum = chapMatch[1];
      result[bookName][chapNum] = {};

      // Match all <verse> elements within this chapter
      const verseRegex = /<verse\s+number="(\d+)">([\s\S]*?)<\/verse>/g;
      const chapContent = chapMatch[2];
      let verseMatch;

      while ((verseMatch = verseRegex.exec(chapContent)) !== null) {
        const verseNum = verseMatch[1];
        // Clean up the verse text: remove extra whitespace, normalize line breaks
        let text = verseMatch[2]
          .replace(/\s+/g, " ")
          .trim();
        result[bookName][chapNum][verseNum] = text;
      }
    }
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    console.log("\nAvailable English Bible versions from Beblia:\n");
    for (const [fileName, id] of Object.entries(KNOWN_ENGLISH)) {
      console.log(`  ${id.toUpperCase().padEnd(8)} → node scripts/downloadBibleXml.cjs ${fileName}`);
    }
    console.log("\nFor other languages, check: https://github.com/Beblia/Holy-Bible-XML-Format");
    return;
  }

  if (args.length === 0) {
    console.log("Usage: node scripts/downloadBibleXml.cjs <BibleFileName>");
    console.log("       node scripts/downloadBibleXml.cjs --list");
    console.log("\nExample: node scripts/downloadBibleXml.cjs EnglishESVBible");
    return;
  }

  const fileName = args[0];
  const id = KNOWN_ENGLISH[fileName] || fileName.toLowerCase().replace(/bible$/i, "").replace(/^english/i, "");
  const url = `${BASE_URL}/${fileName}.xml`;
  const outPath = path.join(__dirname, "..", "public", `bible-${id}.json`);

  console.log(`\nDownloading ${fileName} from Beblia...`);
  console.log(`URL: ${url}`);

  try {
    const xml = await fetch(url);
    console.log(`Downloaded ${(xml.length / 1024).toFixed(0)} KB of XML`);

    console.log("Parsing XML...");
    const bible = parseBebliaXml(xml);

    const books = Object.keys(bible);
    let totalVerses = 0;
    for (const book of books) {
      for (const chap of Object.keys(bible[book])) {
        totalVerses += Object.keys(bible[book][chap]).length;
      }
    }

    console.log(`Parsed ${books.length} books, ${totalVerses} verses`);
    console.log(`Writing to ${outPath}...`);

    fs.writeFileSync(outPath, JSON.stringify(bible, null, 0));
    const stats = fs.statSync(outPath);
    console.log(`Done! Output: ${outPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`\nTo add this translation to the app, update AVAILABLE_TRANSLATIONS in types.ts`);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

main();
