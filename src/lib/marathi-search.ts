/**
 * Smart Marathi & English Bilingual Search & Phonetic Matching
 * Enables searching Maharashtra 7/12 RoR land records by:
 * - Marathi or English script interchangeably (e.g. 'sahare' matches 'सहारे', 'mahendra' matches 'महेंद्र')
 * - Surname detection and grouping
 * - Full Name multi-parcel tracking
 *
 * Matching is token-based and anchored: every token of the query must match some
 * token of the owner name, and a token matches only by equality or by prefix with a
 * minimum length. Substring matching in either direction is deliberately NOT used —
 * it made a one-letter query match nearly every parcel, and made a full-name query
 * match anyone who shared a single token with it.
 */

const DEVANAGARI_MATRAS: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ॅ": "a", "ॉ": "o", "ॄ": "ri",
};

/**
 * Anusvara / visarga / candrabindu. These attach AFTER the syllable's vowel, so they are
 * not vowel signs: चंद्र is cha+n+dra, not chn+dra. Treating them as matras (as this file
 * previously did) swallowed the inherent vowel and produced "chndra".
 */
const DEVANAGARI_SIGNS: Record<string, string> = {
  "ं": "n", "ः": "h", "ँ": "n",
};

/** Multi-codepoint conjuncts, checked before single characters. Values are consonant-only. */
const DEVANAGARI_CONJUNCTS: Record<string, string> = {
  "क्ष": "ksh", "ज्ञ": "dny", "त्र": "tr", "श्र": "shr",
};

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
  "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
};

/** Two-codepoint vowels, checked before single characters. */
const DEVANAGARI_VOWEL_PAIRS: Record<string, string> = {
  "अं": "an", "अः": "ah",
};

const DEVANAGARI_VOWELS: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
  "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
};

export const KNOWN_NAME_MAPPINGS: Record<string, string[]> = {
  "सहारे": ["sahare", "sahre", "saharey"],
  "गोर्रे": ["gorre", "gorle", "goure"],
  "गोर्ले": ["gorle", "gorre", "gorlay"],
  "निचळ": ["nichal", "nichol"],
  "लायडे": ["layde", "laide", "layade"],
  "पाटील": ["patil", "patel"],
  "गायकवाड": ["gaikwad", "gayakwad"],
  "पवार": ["pawar", "puar"],
  "शिंदे": ["shinde", "scindia"],
  "देशमुख": ["deshmukh", "desmukh"],
  "जाधव": ["jadhav", "yadav", "jadav"],
  "वाघमारे": ["waghmare", "vaghmare"],
  "कदम": ["kadam"],
  "मोरे": ["more"],
  "भोसले": ["bhosale", "bhosle"],
  "काळे": ["kale"],
  "चव्हाण": ["chavan", "chavhan", "chauhan"],
  "इंगळे": ["ingle"],
  "तांबडे": ["tambade", "tambde"],
  "थोरात": ["thorat"],
  "वाघ": ["wagh", "vagh"],
  "जोशी": ["joshi"],
  "सावंत": ["sawant", "savant"],
  "बोबडे": ["bobde", "bobade"],
  "चोरे": ["chore"],
  "कोल्हे": ["kolhe"],
  "ठाकरे": ["thakre", "thackeray", "thakare"],
  "राऊत": ["raut", "rawat"],
  "लोखंडे": ["lokhande"],
  "वानखडे": ["wankhade", "vankhade"],
  "ढोके": ["dhoke"],
  "बोंडे": ["bonde"],
  "महेंद्र": ["mahendra", "mahender"],
  "सोमराज": ["somraj", "somraaj"],
  "लंकेश": ["lankesh"],
  "योगेश": ["yogesh"],
  "गोविंदराव": ["govindrao", "govindrav", "govind"],
  "मिलींद": ["milind"],
  "श्रीकृष्ण": ["shrikrishna", "shrikishan"],
  "विरेंद्र": ["virendra", "virender"],
  "प्रफुल": ["praful", "prafull"],
  "गोपाल": ["gopal"],
  "मोतीराम": ["motiram"],
  "विठ्ठल": ["vitthal", "vithal"],
  "तुकाराम": ["tukaram"],
  "नामदेव": ["namdev"],
  "संभाजी": ["sambhaji"],
  "दत्तात्रय": ["dattatray", "dattatreya"],
  "बाबुराव": ["baburao", "baburav"],
  "चंद्रकांत": ["chandrakant"],
  "गणपत": ["ganpat"],
  "किसन": ["kisan"],
  "लक्ष्मण": ["laxman", "lakshman"],
  "ज्ञानेश्वर": ["dnyaneshwar", "gyaneshwar"],
  "एकनाथ": ["eknath"],
  "संजय": ["sanjay"],
  "मारुती": ["maruti"],
  "प्रकाश": ["prakash"],
  "बळीराम": ["baliram"],
  "राजाराम": ["rajaram"],
  "सखाराम": ["sakharam"],
  "शंकर": ["shankar"],
  "निवृत्ती": ["nivritti", "nivrutti"],
  "भगवान": ["bhagwan"],
  "नारायण": ["narayan"],
  "रमेश": ["ramesh"],
  "अशोक": ["ashok"],
};

/** Minimum query-token length before prefix matching is allowed. */
const MIN_PREFIX_LEN = 3;

const DEVANAGARI_RE = /[ऀ-ॿ]/;

interface Syllable {
  /** Consonant cluster, e.g. "kh", "ksh", or "" for a standalone vowel. */
  cons: string;
  /** Explicit vowel from a matra or an independent vowel; "" means the inherent schwa. */
  vowel: string;
  /** True when a matra or independent vowel was written (so no schwa decision is needed). */
  explicitVowel: boolean;
  /** True when a virama cut the vowel off entirely (half form). */
  half: boolean;
  /** Anusvara / visarga trailing the syllable. */
  sign: string;
}

/** Splits one Devanagari word into syllables, before any schwa decisions are made. */
function parseSyllables(word: string): Syllable[] {
  const out: Syllable[] = [];
  const len = word.length;

  for (let i = 0; i < len; i++) {
    const ch = word[i] as string;

    // Multi-codepoint conjunct (क्ष, ज्ञ, त्र, श्र) — tested before single characters,
    // otherwise these table entries could never be reached by a per-character lookup.
    const conj = DEVANAGARI_CONJUNCTS[word.slice(i, i + 3)];
    let cons: string | undefined = conj;
    if (conj) {
      i += 2;
    } else {
      const pairVowel = DEVANAGARI_VOWEL_PAIRS[word.slice(i, i + 2)];
      if (pairVowel) {
        out.push({ cons: "", vowel: pairVowel, explicitVowel: true, half: false, sign: "" });
        i++;
        continue;
      }
      const vowel = DEVANAGARI_VOWELS[ch];
      if (vowel) {
        out.push({ cons: "", vowel, explicitVowel: true, half: false, sign: "" });
        continue;
      }
      cons = DEVANAGARI_CONSONANTS[ch];
    }

    if (!cons) {
      const sign = DEVANAGARI_SIGNS[ch];
      const last = out[out.length - 1];
      if (sign && last) {
        last.sign += sign;
        continue;
      }
      const stray = DEVANAGARI_MATRAS[ch];
      out.push({ cons: "", vowel: sign ?? stray ?? ch, explicitVowel: true, half: false, sign: "" });
      continue;
    }

    const syl: Syllable = { cons, vowel: "", explicitVowel: false, half: false, sign: "" };

    // Consume a virama or a matra, then any trailing anusvara/visarga.
    const next = word[i + 1];
    if (next === "्") {
      syl.half = true;
      i++;
    } else if (next && DEVANAGARI_MATRAS[next]) {
      syl.vowel = DEVANAGARI_MATRAS[next] as string;
      syl.explicitVowel = true;
      i++;
    }
    while (i + 1 < len) {
      const sign = DEVANAGARI_SIGNS[word[i + 1] as string];
      if (!sign) break;
      syl.sign += sign;
      i++;
    }
    out.push(syl);
  }

  return out;
}

/**
 * Renders parsed syllables, applying Marathi schwa deletion.
 *
 * Marathi drops the inherent 'a' of a word-final simple consonant (पाटील -> patil) but
 * keeps it after a conjunct (महेंद्र -> mahendra), and drops it medially when the next
 * syllable carries its own written vowel (वाघमारे -> vaghmare, देशमुख -> deshmukh).
 * Without the medial rule an English query like "waghmare" never lines up with the
 * transliteration and only a dictionary entry can save it.
 */
function renderSyllables(syls: Syllable[]): string {
  let out = "";
  let prevDeleted = false;

  for (let i = 0; i < syls.length; i++) {
    const s = syls[i] as Syllable;
    if (s.half) {
      out += s.cons + s.sign;
      prevDeleted = false;
      continue;
    }
    if (s.explicitVowel) {
      out += s.cons + s.vowel + s.sign;
      prevDeleted = false;
      continue;
    }

    const next = syls[i + 1];
    // Guards shared by both rules: a word-initial schwa is always pronounced, a schwa
    // carrying a nasal sign has to stay to bear it, and the second half of a conjunct
    // keeps its vowel (महेंद्र -> mahendra, प्रकाश -> prakash).
    const eligible = i > 0 && !s.sign && !syls[i - 1]?.half;
    let drop = false;

    if (!next) {
      drop = eligible;
    } else if (eligible && s.cons !== "y" && !prevDeleted) {
      // Medial schwa. Two consecutive schwas cannot both go (वानखडे -> vankhade, not
      // vnkhade), hence !prevDeleted. And it stays if the only syllable left is itself a
      // word-final schwa that will lose its vowel, which would leave none at all
      // (शंकर -> shankar, कदम -> kadam).
      const nextIsFinalSchwa = !syls[i + 2] && !next.explicitVowel && !next.half;
      drop = !nextIsFinalSchwa;
    }

    out += s.cons + (drop ? "" : "a") + s.sign;
    prevDeleted = drop;
  }
  return out;
}

/** Transliterates Devanagari text into an English phonetic representation. */
export function devanagariToEnglish(text: string): string {
  if (!text) return "";
  return text
    .split(/(\s+)/)
    .map((part) => (/^\s*$/.test(part) ? (part ? " " : "") : renderSyllables(parseSyllables(part))))
    .join("")
    .trim();
}

/**
 * Normalizes an English string phonetically to eliminate spelling variations
 * (e.g., 'w' vs 'v', 'ee' vs 'i', 'oo' vs 'u', double consonants, schwa differences).
 */
export function normalizePhonetics(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/ou/g, "au")
    .replace(/w/g, "v")
    .replace(/x/g, "ks")
    .replace(/chh/g, "c")
    .replace(/sh/g, "s")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/gh/g, "g")
    .replace(/kh/g, "k")
    .replace(/ph/g, "f")
    .replace(/zh/g, "z")
    .replace(/ch/g, "c")
    .replace(/ay/g, "ai") // gaykvad ~ gaikwad
    .replace(/n(?=[bpm])/g, "m") // anusvara before a labial: tanbde ~ tambde
    .replace(/(.)\1+/g, "$1") // collapses repeated characters (e.g. 'rr' -> 'r')
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Reverse index: english spelling -> the Devanagari words it can stand for.
 * Built once so an English query can be resolved to Devanagari and compared by
 * equality, instead of relying on the lossy transliteration lining up exactly.
 */
const ENGLISH_TO_DEVANAGARI: Record<string, string[]> = (() => {
  const idx: Record<string, string[]> = {};
  for (const [mr, variants] of Object.entries(KNOWN_NAME_MAPPINGS)) {
    for (const v of variants) {
      for (const key of [v.toLowerCase(), normalizePhonetics(v)]) {
        if (!key) continue;
        if (!idx[key]) idx[key] = [];
        if (!idx[key].includes(mr)) idx[key].push(mr);
      }
    }
  }
  return idx;
})();

export function englishToDevanagariCandidates(query: string): string[] {
  if (!query) return [];
  const q = query.trim().toLowerCase();
  return ENGLISH_TO_DEVANAGARI[q] || ENGLISH_TO_DEVANAGARI[normalizePhonetics(q)] || [];
}

/** Splits a name or query into comparable word tokens. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .split(/[\s,;./\\|()[\]-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Stable grouping key for a surname. Uses the Devanagari form as the portal spells it. */
export function surnameKey(surname: string): string {
  return (surname || "").trim();
}

const cachedNorm = new Map<string, string>();
/** normalizePhonetics(devanagariToEnglish(token)), memoized — this runs per keystroke. */
export function tokenNorm(token: string): string {
  let v = cachedNorm.get(token);
  if (v === undefined) {
    v = normalizePhonetics(devanagariToEnglish(token));
    cachedNorm.set(token, v);
  }
  return v;
}

/**
 * Scores one query token against one name token. Returns 0 for no match.
 * Equality scores highest; a prefix match needs at least MIN_PREFIX_LEN characters,
 * so "a" no longer matches every name in the village.
 */
export function scoreToken(nameToken: string, queryToken: string): number {
  if (!nameToken || !queryToken) return 0;
  const q = queryToken.trim().toLowerCase();
  const n = nameToken.trim();
  if (!q || !n) return 0;

  // Query typed in Devanagari — compare scripts directly.
  if (DEVANAGARI_RE.test(q)) {
    if (n === q) return 1;
    if (q.length >= 2 && n.startsWith(q)) return 0.75;
    return 0;
  }

  // Query typed in English.
  const variants = KNOWN_NAME_MAPPINGS[n];
  if (variants?.includes(q)) return 1;
  if (englishToDevanagariCandidates(q).includes(n)) return 1;

  const qNorm = normalizePhonetics(q);
  if (!qNorm) return 0;
  const nNorm = tokenNorm(n);
  if (!nNorm) return 0;

  if (nNorm === qNorm) return 0.95;
  if (variants?.some((v) => normalizePhonetics(v) === qNorm)) return 0.95;

  // Prefix matching only above the minimum length.
  if (qNorm.length >= MIN_PREFIX_LEN) {
    if (nNorm.startsWith(qNorm)) return 0.75;
    if (variants?.some((v) => normalizePhonetics(v).startsWith(qNorm))) return 0.75;
  }
  return 0;
}

/**
 * Scores a whole query against a set of name tokens.
 * EVERY query token must match some name token, which is what stops a two-word
 * full-name query from matching anyone who happens to share one of the words.
 */
export function scoreTokens(nameTokens: string[], queryTokens: string[]): number {
  if (queryTokens.length === 0 || nameTokens.length === 0) return 0;
  let total = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const nt of nameTokens) {
      const s = scoreToken(nt, qt);
      if (s > best) best = s;
      if (best === 1) break;
    }
    if (best === 0) return 0; // one unmatched query token disqualifies the name
    total += best;
  }
  return total / queryTokens.length;
}

/** Which part of the name a search applies to, mirroring the Bhulekh 7/12 name form. */
export type NamePart = "full" | "first" | "middle" | "last";

export interface ParsedOwner {
  fullName: string;
  /** पहिले नाव */
  firstName: string;
  /** मधले नाव (father's name) */
  middleName: string;
  /** आडनाव */
  surname: string;
  /** first + middle, kept for existing callers */
  givenName: string;
  englishFullName: string;
  englishSurname: string;
  /** Government / institutional holder — has no family surname. */
  isGovernment: boolean;
  tokens: string[];
}

/** Institutional holders that must not contribute a family surname. */
const GOVERNMENT_RE =
  /(महाराष्ट्र\s*शासन|शासन|सरकार|विभाग|ग्रामपंचायत|ग्राम\s*पंचायत|नगरपालिका|महानगरपालिका|जिल्हा\s*परिषद|गायरान|गावठाण|ल\.?\s*पा\.?|पाटबंधारे|वन\s*विभाग|रेल्वे|सार्वजनिक\s*बांधकाम)/;

export function isGovernmentOwner(name: string): boolean {
  return Boolean(name) && GOVERNMENT_RE.test(name);
}

/** Owner-name signal for the two land categories a revenue officer most often needs
 * to locate at a glance: official forest department holdings and water bodies. Both
 * are a subset of government ownership, so this is checked in addition to (not instead
 * of) isGovernmentOwner. Forest is checked first so a combined string like the real
 * record "सरकार (कुरन) वनविभाग" (Government (Kuran) Forest Department) resolves to
 * forest rather than being ambiguous with कुरण/pasture-adjacent wording. */
export type EnvCategory = "forest" | "waterbody" | null;

const FOREST_RE = /(वन\s*विभाग|वनविभाग|वन\s*जमीन|कुरण|कुरन|जंगल)/;
const WATERBODY_RE = /(तलाव|तळे|नदी|बंधारा|धरण|पाणथळ|कालवा|नाला|ओढा|पाटबंधारे|जलसंपदा)/;

export function classifyEnvCategory(ownerName: string): EnvCategory {
  if (!ownerName) return null;
  if (FOREST_RE.test(ownerName)) return "forest";
  if (WATERBODY_RE.test(ownerName)) return "waterbody";
  return null;
}

/**
 * Parses a Marathi owner string into individual owners, splitting co-owners and
 * identifying first / middle / surname in the order the 7/12 record uses.
 */
export function parseOwnerName(rawName: string): ParsedOwner[] {
  if (!rawName) return [];
  const owners = rawName
    .split(/[,;\n\r]|(?:\s+आणि\s+)|\s+व\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (owners.length === 0 && rawName.trim()) {
    owners.push(rawName.trim());
  }

  return owners.map((name) => {
    const tokens = tokenize(name);
    const gov = isGovernmentOwner(name);

    let firstName = "";
    let middleName = "";
    let surname = "";

    if (!gov && tokens.length > 0) {
      firstName = tokens[0] ?? "";
      surname = tokens[tokens.length - 1] ?? "";
      if (tokens.length > 2) {
        middleName = tokens.slice(1, tokens.length - 1).join(" ");
      }
    }

    const englishFullName = devanagariToEnglish(name);
    let englishSurname = surname ? devanagariToEnglish(surname) : "";
    const knownEn = KNOWN_NAME_MAPPINGS[surname]?.[0];
    if (knownEn) {
      englishSurname = knownEn.charAt(0).toUpperCase() + knownEn.slice(1);
    }
    // Title-case the derived spelling too, so chips read "Sahare" not "sahare".
    if (englishSurname) {
      englishSurname = englishSurname.charAt(0).toUpperCase() + englishSurname.slice(1);
    }

    return {
      fullName: name,
      firstName,
      middleName,
      surname,
      givenName: [firstName, middleName].filter(Boolean).join(" "),
      englishFullName,
      englishSurname,
      isGovernment: gov,
      tokens,
    };
  });
}

/**
 * Scores a query against one parsed owner, restricted to a part of the name.
 * Returns 0 when it does not match.
 */
export function matchOwner(owner: ParsedOwner, queryTokens: string[], part: NamePart = "full"): number {
  if (!owner || queryTokens.length === 0) return 0;
  let pool: string[];
  switch (part) {
    case "first":
      pool = owner.firstName ? tokenize(owner.firstName) : [];
      break;
    case "middle":
      pool = owner.middleName ? tokenize(owner.middleName) : [];
      break;
    case "last":
      pool = owner.surname ? [owner.surname] : [];
      break;
    default:
      pool = owner.tokens;
  }
  return scoreTokens(pool, queryTokens);
}

/** Scores a query against an arbitrary name string (no parsing). */
export function matchNameText(source: string, query: string): number {
  return scoreTokens(tokenize(source), tokenize(query));
}

/**
 * Back-compatible boolean wrapper over the scoring matcher.
 * @deprecated prefer matchOwner / matchNameText so results can be ranked.
 */
export function isMarathiEnglishMatch(sourceMarathi: string, query: string): boolean {
  return matchNameText(sourceMarathi, query) > 0;
}
