// Auto-categorization for imported bank transactions. Pure functions, no DOM, no deps.
//
// Tier 1 lives in the store: exact payee history (payee.lastCategoryId), which is
// also fed by approving an auto-categorized row — approval = confirmation.
// This module handles payees the user hasn't confirmed before, using the payee
// name AND the memo/notes text together:
//   Tier 2 — naive Bayes over name+memo tokens, trained on the user's own
//            categorized spending. Only fires with a clear 3x margin.
//   Tier 3 — curated merchant-brand dictionary -> semantic bucket.
//   Tier 4 — generic word vocabulary ("food", "ticket", "nails", "payback") -> bucket.
// Buckets map onto the USER'S actual categories by name; no matching category
// name means no guess. Tokens tolerate plurals and 1-letter typos.
// Outflows only — except reimbursement words ("payback"), which may categorize an
// inflow back into a matching category. Imported rows stay unapproved either way.

// ---------- tier 3: merchant brand dictionary ----------

const BUCKETS = [
  ['groceries', /woolworths|woolies|coles\b|aldi\b|iga\b|foodland|foodworks|drakes|spudshed|spud shed|farmer jack|costco|grocer|supermarket|fresh market|asian grocery|harris farm|fruit ?& ?veg/i],
  ['fuel', /\bbp\b|caltex|ampol|shell\b|puma energy|united petrol|liberty petrol|vibe petrol|mobil\b|speedway|petrol|servo\b|7.eleven fuel/i],
  ['dining', /mcdonald|maccas|\bkfc\b|hungry jack|\bhjs?\b|domino|pizza|subway\b|nando|guzman|zambrero|red rooster|grill'?d|oporto|donut|krispy kreme|boost juice|gong cha|chatime|starbucks|gloria jean|muffin break|jamaica blue|dome cafe|cafe|coffee|espresso|restaurant|sushi|kebab|charcoal chicken|chicken treat|bakery|bakers delight|doordash|uber ?eats|menulog|deliveroo|easi\b|hungry panda|burger|taco|noodle|ramen|pho\b|bistro|eatery|food court|fish ?n ?chip|pepper ?lunch|schnitz|betty's burgers|roll'?d|soul origin|sumo salad|mad mex|grilled|ogalo|el jannah|milky lane|yo.?chi|baskin|cold rock|gelare|gelatissimo|san churro|max brenner|pancake|ihop\b|denny'?s/i],
  ['subscriptions', /netflix|spotify|disney|stan\.|binge|paramount|kayo|youtube|prime video|audible|apple\.com|apple music|itunes|google one|google storage|icloud|openai|chatgpt|anthropic|claude\.ai|midjourney|patreon|crunchyroll|playstation|ps plus|xbox|nintendo|steamgames|steam purchase|adobe|canva|dropbox|notion\b|linkedin|figma|github|onlyfans|twitch|discord nitro|duolingo|masterclass|skillshare|subscr/i],
  ['phone', /telstra|optus|vodafone|belong\b|amaysim|boost mobile|felix mobile|aldimobile|tpg\b|iinet|aussie broadband|superloop|tangerine|exetel|dodo\b|nbn\b|kogan mobile|lebara|lyca|circles\.life/i],
  ['transport', /transperth|translink|opal card|myki|adelaide metro|metro trains|uber(?! ?eats)|didi\b|ola cabs|shofer|taxi|cabcharge|swan taxis|13cabs|parking|wilson park|secure park|city of .* park|cpp wilson|linkt|eastlink|citylink|e.?toll|rego\b|dept of transport|vicroads|service nsw.*rego/i],
  ['health', /chemist|pharmac|priceline|terry white|amcal|medical|medicare|doctor|dental|dentist|physio|chiro|optometr|specsavers|oscar wylee|opsm|hospital|pathology|radiology|clinipath|healthengine|hotdoc|bulk ?bill/i],
  ['fitness', /jetts|anytime fitness|goodlife|f45|snap fitness|plus fitness|revo fitness|fitness first|world gym|crunch fitness|zap fitness|\bgym\b|rec centre|aquatic centre|swim school|muscle nation|myprotein|bulk nutrients|asn\b/i],
  ['shopping', /bunnings|kmart|target aust|big w\b|jb hi|officeworks|amazon(?!.*prime video)|ebay|myer\b|david jones|cotton on|uniqlo|h ?& ?m\b|zara\b|culture kings|city beach|universal store|glue store|rebel sport|rebel\b|bcf\b|anaconda|supercheap|autobarn|repco|ikea|temu\b|shein|wish\.com|typo\b|smiggle|lovisa|priceattack|toyworld|eb games|the reject shop|cheap as chips|spotlight|harvey norman|the good guys|bing lee|dick smith|kathmandu|macpac|nike\b|adidas|foot locker|platypus|hype dc/i],
  ['utilities', /synergy|alinta|\bagl\b|origin energy|red energy|energyaustralia|simply energy|water corp|sydney water|yarra valley water|atco gas|kleenheat|horizon power|ergon|aurora energy|electricit/i],
  ['insurance', /budget direct|aami\b|rac insur|racv|racq|\bhbf\b|bupa|medibank|\bnib\b|allianz|\bqbe\b|youi|ahm\b|suncorp insur|shannons|insurance/i],
  ['entertainment', /hoyts|event cinemas|reading cinema|palace cinema|village cinema|imax|ticketek|ticketmaster|moshtix|oztix|humanitix|eventbrite|rac arena|asm global|timezone|holey moley|strike bowling|escape hunt|zone bowling|kingpin|arcade|cinema|luna park|adventure world|dreamworld|movie world|sea world|wet.?n.?wild/i],
  ['alcohol', /bws\b|dan murphy|liquorland|first choice liquor|cellarbrations|bottlemart|thirsty camel|liquor barons|vintage cellars|bottle.?o\b/i],
  ['travel', /qantas|jetstar|virgin aust|rex airlines|bonza|airasia|emirates|singapore air|flight centre|webjet|booking\.com|agoda|expedia|airbnb|trivago|hostelworld|hotels\.com|stayz/i],
  ['pets', /petbarn|petstock|pet circle|greencross vet|\bvet\b|petcover|budget pet/i],
  ['fees', /transaction fee|account fee|atm fee|international.*fee|monthly fee|overdraw|dishonour|honour fee|interest charged|excess interest|late fee|card fee|govt.*charge|bank@post/i],
];

// ---------- tier 4: generic word vocabulary ----------
// plain words people type in memos/notes, or that survive in bank descriptions

const WORD_BUCKETS = {
  groceries: 'groceries grocery veggies vegetables fruit milk bread eggs meat butcher deli',
  dining: 'food lunch dinner breakfast brunch snack takeaway takeout meal restaurant cafe coffee drink boba feed hungry kebab dessert icecream churros',
  fuel: 'fuel petrol servo diesel',
  entertainment: 'ticket movie cinema concert gig show festival bowling arcade event outing golf minigolf karaoke',
  personal: 'nails haircut hair salon barber beauty spa massage skincare makeup cosmetics waxing lashes brows tanning facial manicure pedicure grooming',
  gifts: 'gift present bday birthday wedding anniversary flowers',
  housing: 'rent bond lease mortgage strata',
  transport: 'bus train tram taxi cab ride toll parking rego fare',
  health: 'doctor dentist meds medicine prescription physio checkup scripts',
  fitness: 'gym workout protein creatine supplements membership',
  travel: 'flight hotel motel holiday trip vacation luggage accommodation',
  education: 'tuition uni tafe course textbook semester hecs enrolment',
  pets: 'vet kibble petfood grooming',
  alcohol: 'beer wine vodka whiskey liquor bottleshop booze drinks pub',
  shopping: 'clothes clothing shoes sneakers jeans dress shirt hoodie jacket makeup',
  utilities: 'electricity power water gas',
  fees: 'fee fine penalty',
  reimbursement: 'payback repay repayment reimburse reimbursement owed owes refund',
  charity: 'donation charity tithe zakat',
};
const singular = t => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) ? t.slice(0, -1) : t;

// keys are stored plural-normalized, matching what tokensOf() produces
const WORD_TO_BUCKET = new Map();
for (const [bucket, words] of Object.entries(WORD_BUCKETS))
  for (const w of words.split(' ')) {
    const key = singular(w);
    if (!WORD_TO_BUCKET.has(key)) WORD_TO_BUCKET.set(key, bucket);
  }
const WORD_KEYS = [...WORD_TO_BUCKET.keys()];

// bucket -> which of the USER'S categories it may land in, by name
const BUCKET_CATEGORY = {
  groceries: /grocer|supermarket/i,
  fuel: /fuel|petrol/i,
  dining: /dining|restaurant|take ?-?away|fast food|eating out|food/i,
  subscriptions: /subscription|streaming|software/i,
  phone: /phone|mobile|internet|telco/i,
  transport: /transport|commut|parking|travel/i,
  health: /health|medical|pharmac/i,
  fitness: /gym|fitness|sport/i,
  shopping: /shopping|clothing|clothes|household/i,
  utilities: /utilit|electric|power|water|energy|gas/i,
  insurance: /insurance/i,
  entertainment: /entertain|fun|leisure|going out|outing/i,
  fees: /\bfee|bank charge|interest/i,
  personal: /personal|self ?-?care|beauty|grooming/i,
  gifts: /gift|present/i,
  housing: /rent|housing|mortgage|home/i,
  travel: /travel|holiday|vacation|trip/i,
  education: /education|school|uni\b|study|course/i,
  pets: /\bpet|\bdog|\bcat|\bvet/i,
  alcohol: /alcohol|liquor|booze|drink/i,
  charity: /charity|giving|donat/i,
  reimbursement: /payback|reimburse|repay|owed|splitwise/i,
};

// ---------- tokens + typo tolerance ----------

const STOP = new Set(['the', 'and', 'pty', 'ltd', 'from', 'for', 'fast', 'transfer', 'commbank', 'app', 'card', 'aus', 'perth', 'sydney', 'melbourne', 'brisbane', 'adelaide']);
const tokensOf = text => String(text ?? '').toLowerCase().replace(/'/g, '').split(/[^a-z0-9]+/)
  .filter(t => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t))
  .map(singular);

// Damerau-Levenshtein distance <= 1 (one substitution, insertion, deletion, or swap)
export function dist1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff = [];
    for (let i = 0; i < la && diff.length <= 2; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < s.length) {
    if (s[i] === l[j]) { i++; j++; }
    else if (!skipped) { skipped = true; j++; }
    else return false;
  }
  return true;
}

// A fuzzy hit must keep the first letter (kills foodie->hoodie style false positives;
// real typos rarely touch the first char) — except a stray leading letter ("sfood").
export function fuzzyEq(a, b) {
  return (a[0] === b[0] && dist1(a, b)) || a.slice(1) === b || b.slice(1) === a;
}

// exact -> fuzzy (only for words long enough that 1 edit is probably a typo)
function wordBucket(tok) {
  const hit = WORD_TO_BUCKET.get(tok);
  if (hit) return hit;
  if (tok.length < 5) return null;
  const near = WORD_KEYS.find(k => k.length >= 5 && fuzzyEq(tok, k));
  return near ? WORD_TO_BUCKET.get(near) : null;
}

// ---------- tier 2: naive Bayes on the user's own history ----------

export function trainClassifier(state) {
  const payeeName = new Map(state.payees.map(p => [p.id, p.name]));
  const valid = new Set(state.categories.filter(c => !c.hidden && !c.ccAccountId).map(c => c.id));
  const cats = new Map();
  let total = 0;
  const vocab = new Set();
  for (const t of state.transactions) {
    if (!t.categoryId || !valid.has(t.categoryId) || !t.payeeId || t.transferAccountId || t.amount >= 0) continue;
    const toks = tokensOf(`${payeeName.get(t.payeeId) ?? ''} ${t.memo ?? ''}`);
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

export function classify(model, text) {
  if (model.total < 10) return null; // not enough history to trust
  const toks = tokensOf(text)
    .map(t => model.vocab.has(t) ? t
      : (t.length >= 5 ? [...model.vocab].find(v => v.length >= 5 && fuzzyEq(t, v)) : null))
    .filter(Boolean);
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

function categoryFor(state, bucket) {
  const re = BUCKET_CATEGORY[bucket];
  const cat = re && state.categories.find(c => !c.hidden && !c.ccAccountId && re.test(c.name));
  return cat ? cat.id : null;
}

export function suggestCategory(state, payeeName, amount, model, memo = '') {
  const text = `${payeeName ?? ''} ${memo ?? ''}`.trim();
  if (!text) return null;

  // inflows: only reimbursement words may categorize ("payback" offsets the original spend)
  if (!(amount < 0)) {
    const isPayback = tokensOf(text).some(t => wordBucket(t) === 'reimbursement');
    return isPayback ? categoryFor(state, 'reimbursement') : null;
  }

  const learned = model ? classify(model, text) : null;
  if (learned) return learned;

  for (const [bucket, re] of BUCKETS) {
    if (re.test(text)) return categoryFor(state, bucket);
  }

  // generic words: majority vote across name+memo tokens
  const votes = new Map();
  for (const t of tokensOf(text)) {
    const b = wordBucket(t);
    if (b) votes.set(b, (votes.get(b) || 0) + 1);
  }
  let bestBucket = null, bestVotes = 0;
  for (const [b, n] of votes) if (n > bestVotes) { bestBucket = b; bestVotes = n; }
  return bestBucket ? categoryFor(state, bestBucket) : null;
}
