// Auto-categorization for imported bank transactions. Pure functions, no DOM, no deps.
//
// Tier 1 lives in the store: exact payee history (payee.lastCategoryId).
// This module adds, for payees the user hasn't categorized before:
//   Tier 2 — naive Bayes over payee-name tokens, trained on the user's own
//            categorized spending (learns THEIR habits: if their kebab shops go
//            to "Fun Money", new kebab shops do too). Only fires with a clear margin.
//   Tier 3 — curated merchant-keyword dictionary -> semantic bucket -> the user's
//            actual category, matched by category name. Skips silently when the
//            user has no matching category; never guesses into the wrong one.
// Suggestions only apply to outflows; imported rows stay unapproved either way,
// so a wrong guess is one tap to fix in the approval flow.

// ---------- tier 3: merchant dictionary ----------

const BUCKETS = [
  ['groceries', /woolworths|coles\b|aldi\b|iga\b|foodland|spudshed|spud shed|farmer jack|costco|grocer|supermarket|fresh market|asian grocery/i],
  ['fuel', /\bbp\b|caltex|ampol|shell\b|puma energy|united petrol|liberty petrol|vibe petrol|petrol|servo\b/i],
  ['dining', /mcdonald|maccas|\bkfc\b|hungry jack|\bhjs?\b|domino|pizza|subway\b|nando|guzman|zambrero|red rooster|grill'?d|oporto|donut|krispy kreme|boost juice|gong cha|chatime|starbucks|gloria jean|muffin break|jamaica blue|dome cafe|cafe|coffee|espresso|restaurant|sushi|kebab|charcoal chicken|chicken treat|bakery|bakers delight|doordash|uber ?eats|menulog|deliveroo|easi\b|hungry panda|burger|taco|noodle|ramen|pho\b|bistro|eatery|food court|fish ?n ?chip|pepper ?lunch/i],
  ['subscriptions', /netflix|spotify|disney|stan\.|binge|paramount|kayo|youtube|prime video|audible|apple\.com|apple music|itunes|google one|google storage|icloud|openai|chatgpt|anthropic|claude\.ai|midjourney|patreon|crunchyroll|playstation|ps plus|xbox|nintendo|steamgames|steam purchase|adobe|canva|dropbox|notion\b|linkedin|subscr/i],
  ['phone', /telstra|optus|vodafone|belong\b|amaysim|boost mobile|felix mobile|aldimobile|tpg\b|iinet|aussie broadband|superloop|tangerine|nbn\b/i],
  ['transport', /transperth|translink|opal card|myki|adelaide metro|uber(?! ?eats)|didi\b|ola cabs|shofer|taxi|cabcharge|swan taxis|parking|wilson park|secure park|city of .* park|cpp wilson/i],
  ['health', /chemist|pharmac|priceline|terry white|amcal|medical|medicare|doctor|dental|dentist|physio|chiro|optometr|specsavers|oscar wylee|hospital|pathology|radiology|clinipath|healthengine/i],
  ['fitness', /jetts|anytime fitness|goodlife|f45|snap fitness|plus fitness|revo fitness|fitness first|\bgym\b|rec centre|aquatic centre/i],
  ['shopping', /bunnings|kmart|target aust|big w\b|jb hi|officeworks|amazon(?!.*prime video)|ebay|myer\b|david jones|cotton on|uniqlo|h ?& ?m\b|zara\b|culture kings|city beach|rebel sport|rebel\b|bcf\b|anaconda|supercheap|autobarn|repco|ikea|temu\b|shein|typo\b|smiggle|lovisa|priceattack|toyworld|eb games/i],
  ['utilities', /synergy|alinta|\bagl\b|origin energy|red energy|energyaustralia|water corp|atco gas|kleenheat|horizon power|electricit/i],
  ['insurance', /budget direct|aami\b|rac insur|\bhbf\b|bupa|medibank|\bnib\b|allianz|\bqbe\b|youi|ahm\b|insurance/i],
  ['entertainment', /hoyts|event cinemas|reading cinema|palace cinema|village cinema|ticketek|ticketmaster|moshtix|oztix|rac arena|asm global|timezone|holey moley|strike bowling|escape hunt|zone bowling|arcade|cinema/i],
  ['fees', /transaction fee|account fee|atm fee|international.*fee|monthly fee|overdraw|dishonour|honour fee|interest charged|excess interest|late fee|card fee|govt.*charge/i],
];

// bucket -> which of the USER'S categories it may land in, by name
const BUCKET_CATEGORY = {
  groceries: /grocer|supermarket/i,
  fuel: /fuel|petrol/i,
  dining: /dining|restaurant|take ?-?away|fast food|eating out/i,
  subscriptions: /subscription|streaming|software/i,
  phone: /phone|mobile|internet|telco/i,
  transport: /transport|commut|parking|travel/i,
  health: /health|medical|pharmac/i,
  fitness: /gym|fitness|sport/i,
  shopping: /shopping|clothing|clothes|household/i,
  utilities: /utilit|electric|power|water|energy|gas/i,
  insurance: /insurance/i,
  entertainment: /entertain|fun|leisure|going out/i,
  fees: /\bfee|bank charge|interest/i,
};

// ---------- tier 2: naive Bayes on the user's own history ----------

const STOP = new Set(['the', 'and', 'pty', 'ltd', 'from', 'fast', 'transfer', 'commbank', 'app', 'card', 'aus', 'perth', 'sydney', 'melbourne', 'brisbane', 'adelaide']);
const tokensOf = name => String(name ?? '').toLowerCase().split(/[^a-z0-9]+/)
  .filter(t => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t));

export function trainClassifier(state) {
  const payeeName = new Map(state.payees.map(p => [p.id, p.name]));
  const valid = new Set(state.categories.filter(c => !c.hidden && !c.ccAccountId).map(c => c.id));
  const cats = new Map();
  let total = 0;
  const vocab = new Set();
  for (const t of state.transactions) {
    if (!t.categoryId || !valid.has(t.categoryId) || !t.payeeId || t.transferAccountId || t.amount >= 0) continue;
    const toks = tokensOf(payeeName.get(t.payeeId));
    if (!toks.length) continue;
    let c = cats.get(t.categoryId);
    if (!c) cats.set(t.categoryId, c = { docs: 0, tokens: new Map(), tokenTotal: 0 });
    c.docs++; total++;
    for (const tok of toks) {
      c.tokens.set(tok, (c.tokens.get(tok) || 0) + 1);
      c.tokenTotal++;
      vocab.add(tok);
    }
  }
  return { cats, total, vocab };
}

export function classify(model, name) {
  if (model.total < 10) return null; // not enough history to trust
  const toks = tokensOf(name).filter(t => model.vocab.has(t));
  if (!toks.length) return null;
  const V = model.vocab.size;
  let bestCat = null, best = -Infinity, second = -Infinity;
  for (const [catId, c] of model.cats) {
    let score = Math.log(c.docs / model.total);
    for (const t of toks) score += Math.log(((c.tokens.get(t) || 0) + 1) / (c.tokenTotal + V));
    if (score > best) { second = best; best = score; bestCat = catId; }
    else if (score > second) second = score;
  }
  return best - second >= Math.log(3) ? bestCat : null; // require a clear 3x margin
}

// ---------- entry point ----------

export function suggestCategory(state, payeeName, amount, model) {
  if (!payeeName || !(amount < 0)) return null; // outflows only
  const learned = model ? classify(model, payeeName) : null;
  if (learned) return learned;
  for (const [bucket, re] of BUCKETS) {
    if (!re.test(payeeName)) continue;
    const catRe = BUCKET_CATEGORY[bucket];
    const cat = state.categories.find(c => !c.hidden && !c.ccAccountId && catRe.test(c.name));
    return cat ? cat.id : null;
  }
  return null;
}
