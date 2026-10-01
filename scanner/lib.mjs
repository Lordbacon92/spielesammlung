// COLLECT Deal-Scanner – reine Logik (ohne Netzwerk), damit sie testbar bleibt.

// Suchbegriffe pro Plattform (wie in index.html → platforms[].ebay)
export const PLATFORM_QUERY = {
  'Atari': 'Atari 2600', 'Commodore 64': 'C64', 'NES': 'NES', 'Mastersystem': 'Master System',
  'SNES': 'SNES', 'Megadrive': 'Mega Drive', 'PS1': 'PS1', 'Saturn': 'Saturn', 'N64': 'N64',
  'Gamecube': 'Gamecube', 'Ps2': 'PS2', 'PS3': 'PS3', 'PS4': 'PS4', 'PS5': 'PS5',
  'Switch': 'Switch', 'Switch2': 'Switch 2', 'GB': 'Gameboy', 'GBC': 'Gameboy Color',
  'GBA': 'GBA', 'NDS': 'Nintendo DS', '3DS': '3DS', 'Konsole/Parts': '', 'Amiga 500': 'Amiga', 'PC': 'PC'
};

// Modul-Plattformen: hier macht Modul / CIB / Sealed preislich einen großen Unterschied
export const CART_PLATFORMS = ['Atari', 'NES', 'SNES', 'N64', 'Megadrive', 'Mastersystem', 'GB', 'GBC', 'GBA'];

// eBay-Kategorie „Videospiele“ – für Konsolen/Teile ohne Kategorie suchen
export const CAT_GAMES = '139973';

// ── Text normalisieren ──────────────────────────────────────────────────────
const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map(t => ROMAN[t] || t)
    .join(' ');
}

const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'der', 'die', 'das', 'und', 'von', 'im', 'in', 'to', 'for', 'edition', 'version', 'eu', 'pal', 'de']);

// "Contra/Probotector ( US/EU)" → [["contra"], ["probotector"]]
export function gameAlternatives(title) {
  const clean = String(title).replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const alts = clean.split('/').map(s => s.trim()).filter(Boolean);
  return alts.map(a => {
    const toks = norm(a).split(' ').filter(Boolean);
    const sig = toks.filter(t => !STOP.has(t));
    return sig.length ? sig : toks;
  }).filter(t => t.length);
}

// Suchtext für eBay (erste Variante + Plattform)
export function buildQuery(game, platform) {
  const alt = String(game).replace(/\([^)]*\)/g, ' ').split('/')[0];
  const words = alt.replace(/[:\-–_,.!?"']/g, ' ').replace(/\s+/g, ' ').trim();
  const p = PLATFORM_QUERY[platform] !== undefined ? PLATFORM_QUERY[platform] : platform;
  return (words + ' ' + p).trim();
}

// Wörter, die in Angebotstiteln neben dem Spielnamen üblich sind und nichts über den Titel aussagen
const GENERIC = new Set((
  'nintendo sony sega microsoft playstation ps ps1 ps2 ps3 ps4 ps5 psx psone one xbox 360 series snes nes n64 super famicom ' +
  'gameboy game boy color colour advance gba gbc gb ds 3ds 2ds nds switch gamecube cube ngc wii mega drive megadrive genesis master system ' +
  'saturn dreamcast atari 2600 7800 amiga c64 commodore pc cd rom dvd windows mac entertainment ' +
  'ovp cib komplett kompl complete boxed box modul cartridge cart disc disk spiel spiele game games videospiel videogame ' +
  'pal eu de deutsch deutsche german version uk fr eur ntsc neu new sealed versiegelt gut sehr top zustand gebraucht used mint ' +
  'selten rare rar retro original orginal originale mit anleitung handbuch manual inkl inklusive und and the der die das von of fur fuer ' +
  'getestet tested funktioniert funktionsfahig ok a b c usk pegi ab jahre 3 6 12 16 18 rpg shooter jump run adventure action racing ' +
  'rennspiel sport sports mmorpg strategie strategy puzzle platformer jrpg klassiker classic kult edition big hulle huelle case ' +
  'konami capcom bethesda ubisoft ea sierra square enix squaresoft namco bandai hudson acclaim eidos activision thq blizzard ' +
  'rockstar vivendi infogrames ocean midway atlus koei taito sunsoft tecmo nintendo64 playstation1 playstation2 sammler ' +
  'vom im in zu zum for with a an spielesammlung top zustand gepflegt sauber vollstandig vollstaendig blitzversand versand ' +
  'player spieler multiplayer coop co op teil part volume vol elder scrolls special pikachu tom clancy s clancys sid meiers disney'
).split(' '));
function isGenericTok(t) { return GENERIC.has(t) || /^(19|20)\d\d$/.test(t) || t.length <= 1; }

// Wie viele „fremde“ Wörter stehen direkt vor / nach dem Spielnamen? (z. B. "Elder Scrolls Online Morrowind", "Starcraft Wings of Liberty")
export function contextReason(itemTitle, game) {
  const it = norm(itemTitle).split(' ');
  for (const toks of gameAlternatives(game)) {
    let pos = -1, start = -1;
    for (const t of toks) {
      const i = it.indexOf(t, pos + 1);
      if (i < 0) { pos = -2; break; }
      if (start < 0) start = i;
      pos = i;
    }
    if (pos < 0) continue;
    const gameSet = new Set(toks);
    const before = it.slice(Math.max(0, start - 3), start).filter(t => !isGenericTok(t) && !gameSet.has(t));
    const after = it.slice(pos + 1, pos + 4).filter(t => !isGenericTok(t) && !gameSet.has(t));
    if (before.length >= 1) return 'vorne: ' + before.join(' ');
    if (after.length >= 2) return 'hinten: ' + after.join(' ');
    return null;
  }
  return null;
}

// Steht der Spieltitel (alle wichtigen Wörter) im Angebotstitel? Fortsetzungen werden ausgeschlossen.
export function titleMatches(itemTitle, game) {
  const it = norm(itemTitle).split(' ');
  const set = new Set(it);
  for (const toks of gameAlternatives(game)) {
    if (!toks.every(t => set.has(t))) continue;
    const hasNum = toks.some(t => /^\d+$/.test(t));
    if (!hasNum) {
      // "Breath of Fire" darf nicht "Breath of Fire 2" treffen
      const last = toks[toks.length - 1];
      let sequel = false;
      it.forEach((t, i) => { if (t === last && /^[2-9]$/.test(it[i + 1] || '')) sequel = true; });
      if (sequel) continue;
    }
    return true;
  }
  return false;
}

// ── Plattform-Erkennung im Angebotstitel ────────────────────────────────────
const PLAT_PATTERNS = [
  ['GBC', /\b(gbc|game ?boy colou?r)\b/],
  ['GBA', /\b(gba|game ?boy advance|gb advance)\b/],
  ['GB', /\b(game ?boy|gb)\b(?! ?(colou?r|advance))/],
  ['SNES', /\b(snes|super nintendo|super nes|super famicom)\b/],
  ['NES', /\b(nes|nintendo entertainment system)\b/],
  ['N64', /\b(n64|nintendo 64)\b/],
  ['3DS', /\b(3ds|2ds)\b/],
  ['NDS', /\b(nds|nintendo ds|ds lite)\b/],
  ['Switch2', /\bswitch 2\b/],
  ['Switch', /\bswitch\b(?! 2)/],
  ['Gamecube', /\b(gamecube|game cube|ngc)\b/],
  ['Megadrive', /\b(mega ?drive|genesis|md)\b/],
  ['Mastersystem', /\b(master ?system|sms)\b/],
  ['Saturn', /\bsaturn\b/],
  ['PS1', /\b(ps1|psx|psone|ps one|playstation 1|playstation one)\b/],
  ['Ps2', /\b(ps2|playstation 2)\b/],
  ['PS3', /\b(ps3|playstation 3)\b/],
  ['PS4', /\b(ps4|playstation 4)\b/],
  ['PS5', /\b(ps5|playstation 5)\b/],
  ['Atari', /\b(atari|2600|7800)\b/],
  ['Amiga 500', /\bamiga\b/],
  ['Commodore 64', /\b(c64|commodore)\b/],
  ['Xbox 360', /\bxbox ?360\b/],
  ['Xbox One', /\bxbox (one|series)\b|\bseries [xs]\b/],
  ['Xbox', /\bxbox\b(?! ?(360|one|series))/],
  ['PC', /\b(pc|cd rom|dvd rom|windows|win 95|win 98|win xp|mac os|big box)\b/],
];
export function detectPlatforms(itemTitle) {
  const n = norm(itemTitle);
  const found = new Set();
  for (const [p, re] of PLAT_PATTERNS) if (re.test(n)) found.add(p);
  return found;
}
function samePlat(a, b) {
  if (a === b) return true;
  const fam = [['Switch', 'Switch2']];
  return fam.some(f => f.includes(a) && f.includes(b));
}
// Passt das Angebot zur gewünschten Plattform? (multi = mehrere Plattformen erlaubt, z. B. Konvolut)
export function platformOk(itemTitle, platform, multi) {
  if (platform === 'Konsole/Parts') return true;
  const found = [...detectPlatforms(itemTitle)];
  if (!PLAT_PATTERNS.some(([p]) => p === platform)) return !found.length;
  if (!found.length) return true;
  const own = found.some(p => samePlat(p, platform));
  if (!own) return false;
  if (multi) return true;
  return found.every(p => samePlat(p, platform));
}

// ── Ausschlüsse ─────────────────────────────────────────────────────────────
const JUNK = [
  'repro', 'reproduction', 'reproduktion', 'nachbau', 'bootleg', 'fake', 'replica', 'replik',
  'nur hulle', 'nur huelle', 'leerhulle', 'leerhuelle', 'leere hulle', 'leere huelle', 'hulle only', 'case only',
  'ohne spiel', 'ohne modul', 'ohne cd', 'ohne disc', 'ohne disk', 'ohne cartridge',
  'nur anleitung', 'anleitung only', 'manual only', 'nur ovp', 'leere ovp', 'leer ovp', 'leerbox', 'box only', 'empty box', 'nur box', 'nur karton',
  'nur cover', 'cover only', 'inlay', 'nur inlay',
  'defekt', 'kaputt', 'bastler', 'fur bastler', 'fuer bastler',
  'spieleberater', 'losungsbuch', 'loesungsbuch', 'strategy guide', 'spiele berater', 'poster', 'aufkleber', 'sticker',
  'schlusselanhanger', 'schluesselanhaenger', 'soundtrack', 'artbook', 'art book', 'magazin', 'zeitschrift', 'pin badge',
  // Zubehör / Ersatzteile statt des Artikels selbst
  'folie', 'schutzfolie', 'displayfolie', 'displayschutz', 'display schutz', 'screen protector', 'skin', 'aufkleberset',
  'ersatzhulle', 'ersatzhuelle', 'ersatz hulle', 'ersatz huelle', 'ersatzteil', 'ersatzteile', 'ersatz', 'replacement',
  'gehause', 'gehaeuse', 'shell', 'housing', 'batteriedeckel', 'akkudeckel', 'battery cover', 'tasche', 'sleeve',
  'hulle fur', 'huelle fuer', 'case fur', 'case fuer', 'nur cover', 'reparatur', 'repair', 'kabel only', 'nur kabel',
  // Werkzeug
  'screwdriver', 'schraubendreher', 'schraubenzieher', 'werkzeug', 'tool', 'tools', 'opening', 'bit', 'bits', 'gamebit', 'triwing', 'tri wing',
  // Deko / Merchandise
  'plakette', 'deko', 'dekoration', 'wandbild', 'bild', 'schild', 'blechschild', 'lampe', 'leuchte', 'figur', 'figuren', 'tasse',
  'shirt', 't shirt', 'merch', 'merchandise', 'miniatur', 'magnet', 'kuhlschrankmagnet', 'mousepad', 'mauspad', 'kissen', 'puzzle', 'lego'
];

// Hinweise auf "nicht komplett" – im OVP-Modus immer raus
const INCOMPLETE = [
  'disc only', 'disk only', 'cd only', 'dvd only', 'nur disc', 'nur disk', 'nur cd', 'nur dvd', 'nur die disc', 'nur die cd',
  'nur modul', 'modul only', 'cartridge only', 'cart only', 'nur cartridge', 'nur das spiel', 'nur spiel', 'game only',
  'lose', 'loose', 'ohne ovp', 'ohne box', 'ohne karton', 'ohne anleitung', 'ohne hulle', 'ohne huelle', 'ohne case',
  'ohne verpackung', 'ohne originalverpackung', 'ohne manual', 'no box', 'no manual', 'no case', 'unboxed',
  'ohne handbuch', 'handbuch fehlt', 'kein handbuch', 'ohne heft', 'ohne beiheft', 'ohne booklet', 'booklet fehlt',
  'nur ovp', 'ovp fehlt', 'anleitung fehlt', 'hulle fehlt', 'huelle fehlt', 'ohne inlay', 'kein ovp', 'keine ovp', 'keine anleitung'
];
// Positive Hinweise auf komplett mit OVP
const COMPLETE_RE = / (ovp|cib|komplett|kompl|complete|completed|vollstandig|vollstaendig|boxed|in box|mit box|mit karton|originalverpackung|original verpackung|mit anleitung|mit hulle|mit huelle|mit case|in hulle|in huelle|sealed|versiegelt|eingeschweisst|neu ovp|new sealed) /;
// "o. OVP", "ohne Anleitung", "w/o box", "kein Handbuch" …
const MISSING_RE = / (ohne|o|w o|wo|without|no|kein|keine|keinen|fehlt|fehlende|missing) (original )?(ovp|box|anleitung|handbuch|hulle|huelle|case|karton|manual|cover|booklet|heft|beiheft|inlay|verpackung|originalverpackung|schuber|insert) /;
const MISSING_AFTER_RE = / (ovp|box|anleitung|handbuch|hulle|huelle|case|manual|cover|booklet) (fehlt|fehlen|missing|nicht dabei|nicht enthalten) /;
export function incompleteReason(itemTitle) {
  const n = ' ' + norm(itemTitle) + ' ';
  const m = n.match(MISSING_RE) || n.match(MISSING_AFTER_RE);
  if (m) return m[0].trim();
  for (const w of INCOMPLETE) if (n.includes(' ' + w + ' ')) return w;
  return null;
}
// ── Beschreibung prüfen ─────────────────────────────────────────────────────
// Text aus HTML-Beschreibung holen
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const NEG = new Set(['kein', 'keine', 'keinen', 'keiner', 'no', 'not', 'nicht', 'never', 'niemals', 'ohne', 'non', 'garantiert', 'ausgeschlossen']);
const DESC_FAKE = ['repro', 'reproduction', 'reproduktion', 'nachbau', 'bootleg', 'fake', 'replica', 'replik', 'kopie', 'nachdruck', 'reprint'];
const DESC_BROKEN = ['defekt', 'kaputt', 'funktioniert nicht', 'startet nicht', 'lauft nicht', 'laeuft nicht', 'gebrochen', 'gerissen', 'starke gebrauchsspuren', 'wasserschaden', 'schimmel'];
const DESC_MISSING = ['disc only', 'cd only', 'nur disc', 'nur cd', 'nur modul', 'modul only', 'cartridge only', 'game only', 'nur das spiel', 'nur das modul'];
function negated(toks, i) {
  for (let k = Math.max(0, i - 3); k < i; k++) if (NEG.has(toks[k])) return true;
  return false;
}
function findPhrase(toks, phrase) {
  const p = phrase.split(' ');
  outer: for (let i = 0; i + p.length <= toks.length; i++) {
    for (let j = 0; j < p.length; j++) if (toks[i + j] !== p[j]) continue outer;
    if (!negated(toks, i)) return phrase;
  }
  return null;
}
// Grund, warum die Beschreibung gegen das Angebot spricht – oder null
export function descriptionReason(text, opts) {
  const n = norm(text);
  if (!n) return null;
  const toks = n.split(' ');
  for (const w of DESC_FAKE) { const r = findPhrase(toks, w); if (r) return r; }
  for (const w of DESC_BROKEN) { const r = findPhrase(toks, w); if (r) return r; }
  if (opts.condition !== 'all') {
    for (const w of DESC_MISSING) { const r = findPhrase(toks, w); if (r) return r; }
    const m = (' ' + n + ' ').match(MISSING_RE) || (' ' + n + ' ').match(MISSING_AFTER_RE);
    if (m) return m[0].trim();
  }
  return null;
}

export function looksComplete(itemTitle, conditionId) {
  if (incompleteReason(itemTitle)) return false;
  const n = ' ' + norm(itemTitle) + ' ';
  return COMPLETE_RE.test(n) || String(conditionId) === '1000';   // 1000 = Neu (originalverpackt)
}
const REGION = ['super famicom', 'famicom', 'sfc', 'jp version', 'jp import', 'jpn version', 'ntsc', 'ntsc j', 'ntsc u', 'jap', 'japan', 'japanisch', 'jpn', 'us import', 'usa', 'us version', 'ntscu', 'ntscj'];

// Sammel- und Sonderausgaben verfälschen den Preisvergleich – nur erlaubt, wenn der gesuchte Titel sie selbst nennt
const VARIANT = [
  'big box', 'bigbox', 'fat box', 'collector', 'collectors', 'collector s', 'limited', 'steelbook', 'anthology', 'anthologie',
  'generation', 'compilation', 'collection', 'bundle', 'pack', 'konvolut', 'sammlung', 'paket', 'lot', 'spielesammlung',
  'spiele', 'games', 'set', 'trilogy', 'trilogie', 'box set', 'boxset', 'premium', 'deluxe', 'gold edition', 'goty',
  'game of the year', 'special edition', 'sonderedition', 'sonderausgabe', 'promo', 'demo', 'beta', 'prototyp'
];
export function variantReason(itemTitle, game) {
  const n = ' ' + norm(itemTitle) + ' ';
  const g = ' ' + norm(game) + ' ';
  for (const w of VARIANT) if (n.includes(' ' + w + ' ') && !g.includes(' ' + w + ' ')) return w;
  if (/ \+ /.test(' ' + String(itemTitle) + ' ')) return '+';           // mehrere Spiele in einem Angebot
  return null;
}

// Vorsichtiger Marktwert: 40-%-Quantil der Angebotspreise (Angebote liegen meist über Verkaufspreisen)
export function quantile(arr, q) {
  const a = arr.filter(x => isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export function junkReason(itemTitle, game, opts) {
  const n = ' ' + norm(itemTitle) + ' ';
  for (const w of JUNK) if (n.includes(' ' + w + ' ')) return w;
  if (opts.excludeNtsc) {
    const g = ' ' + norm(game) + ' ';
    const wantsImport = /\b(us|usa|ntsc|jap|japan|jp)\b/.test(g);
    if (!wantsImport) for (const w of REGION) if (n.includes(' ' + w + ' ')) return w;
  }
  return null;
}

// ── Zustand ─────────────────────────────────────────────────────────────────
export function conditionClass(itemTitle, platform, conditionId) {
  const n = ' ' + norm(itemTitle) + ' ';
  if (/ (sealed|versiegelt|eingeschweisst|factory sealed|ungeoffnet|ungeoeffnet) /.test(n)) return 'sealed';
  if (looksComplete(itemTitle, conditionId)) return String(conditionId) === '1000' && !/ (ovp|cib|komplett|complete|boxed) /.test(n) ? 'sealed' : 'cib';
  return 'modul';
}

// Erfüllt das Angebot den gewählten Zustand? ('cib' = nur komplett mit OVP, 'all' = auch lose)
export function conditionOk(itemTitle, conditionId, opts) {
  if (opts.condition === 'all') return true;
  return looksComplete(itemTitle, conditionId);
}

// ── Preise ──────────────────────────────────────────────────────────────────
export function median(arr) {
  const a = arr.filter(x => isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const r2 = x => Math.round(x * 100) / 100;

// Aus einem eBay item_summary die für uns wichtigen Felder ziehen
export function parseItem(it) {
  const opts = it.buyingOptions || [];
  const isBin = opts.includes('FIXED_PRICE');
  const isAuction = opts.includes('AUCTION');
  const binPrice = it.price ? parseFloat(it.price.value) : NaN;
  const bidPrice = it.currentBidPrice ? parseFloat(it.currentBidPrice.value) : NaN;
  const type = isBin ? 'bin' : (isAuction ? 'auction' : 'bin');
  const price = type === 'bin' ? binPrice : (isFinite(bidPrice) ? bidPrice : binPrice);
  let shipping = null;
  const so = (it.shippingOptions || []).map(s => s && s.shippingCost ? parseFloat(s.shippingCost.value) : NaN).filter(isFinite);
  if (so.length) shipping = Math.min(...so);
  const shipKnown = shipping !== null;
  const ship = shipKnown ? shipping : 5;          // Versand unbekannt → 5 € annehmen
  const seller = it.seller || {};
  return {
    itemId: it.itemId,
    title: it.title || '',
    type,
    price: r2(price),
    shipping: r2(ship),
    shipKnown,
    total: r2(price + ship),
    currency: (it.price && it.price.currency) || 'EUR',
    bids: it.bidCount || 0,
    endsAt: isAuction && it.itemEndDate ? it.itemEndDate : null,
    listedAt: it.itemCreationDate || it.itemOriginDate || null,
    url: it.itemWebUrl || ('https://www.ebay.de/itm/' + String(it.legacyItemId || it.itemId || '').replace(/^v1\|(\d+)\|.*$/, '$1')),
    img: (it.image && it.image.imageUrl) || (it.thumbnailImages && it.thumbnailImages[0] && it.thumbnailImages[0].imageUrl) || '',
    seller: seller.username || '',
    sellerFb: seller.feedbackScore != null ? Number(seller.feedbackScore) : null,
    sellerPct: seller.feedbackPercentage != null ? parseFloat(seller.feedbackPercentage) : null,
    bestOffer: opts.includes('BEST_OFFER'),
    postal: (it.itemLocation && it.itemLocation.postalCode) || '',
    city: (it.itemLocation && (it.itemLocation.city || '')) || '',
    condition: it.condition || '',
    conditionId: it.conditionId || '',
    country: (it.itemLocation && it.itemLocation.country) || ''
  };
}

export function sellerOk(p, opts) {
  if (p.sellerPct !== null && p.sellerFb > 0 && p.sellerPct < opts.minSellerPct) return false;
  if (p.sellerFb !== null && p.sellerFb < opts.minSellerFb) return false;
  return true;
}

// Bewertet ein passendes Angebot. ref = { median, n } oder null; target = Zielpreis oder null
export function evaluate(p, ref, target, opts, nowMs, bonus) {
  if (!isFinite(p.price) || p.price <= 0) return null;
  const med = ref && ref.median ? ref.median : null;
  if (!med && !target) return null;                         // ohne Vergleichswert keine Aussage
  const base = med || target;
  const score = p.total / base;
  const save = base - p.total;
  const thr = opts.threshold + (bonus || 0);
  // Grenze: Zielpreis oder Anteil vom Marktwert – die großzügigere gilt
  const limit = Math.max(target || 0, med ? med * thr : 0);
  let hit = false, offer = null;
  if (target && p.total <= target) hit = true;
  if (med && score <= thr && save >= opts.minSave) hit = true;
  // Preisvorschlag möglich: bis 20 % über der Grenze ist meist verhandelbar
  if (!hit && p.type === 'bin' && p.bestOffer && limit && p.total <= limit * 1.2) {
    hit = true;
    offer = Math.max(1, Math.floor(limit - (p.shipping || 0)));
  }
  if (p.type === 'auction') {
    const left = p.endsAt ? (Date.parse(p.endsAt) - nowMs) / 3600000 : Infinity;
    if (!(left > 0 && left <= opts.auctionHours)) hit = false;   // nur kurz vor Ende interessant
  }
  if (!hit) return null;
  if (med && score < 0.25 && !(target && p.total <= target)) return null;   // so billig ist fast immer ein anderer Artikel
  return {
    offer,
    ref: med ? r2(med) : null,
    refN: ref ? ref.n : 0,
    target: target || null,
    score: Math.round(score * 100) / 100,
    save: r2(save),
    suspicious: !!(med && score < 0.35 && med >= 20)          // zu gut, um wahr zu sein?
  };
}

export const DEFAULT_OPTS = {
  enabled: false,
  threshold: 0.6,          // Gesamtpreis ≤ 60 % des Marktmedians
  minSave: 5,              // mindestens 5 € günstiger
  notifyBelow: 0.5,        // Push ab ≤ 50 %
  auctionHours: 12,        // Auktionen nur in den letzten 12 h
  excludeNtsc: true,
  minSellerPct: 95,
  minSellerFb: 0,
  ntfyTopic: '',
  konvolut: true,
  condition: 'cib',        // 'cib' = nur komplett mit OVP, 'all' = auch lose Module/Discs
  zip: '',                 // PLZ für Abholung in der Nähe
  pickupRadius: 50,        // km
  pickupBonus: 0.15,       // Abholung: Grenze 15 Prozentpunkte großzügiger (kein Versand, wenig Konkurrenz)
  businessMalus: 0.1       // gewerbliche Verkäufer: Grenze 10 Prozentpunkte strenger
};
export function userOpts(dealScan) {
  const o = Object.assign({}, DEFAULT_OPTS, dealScan || {});
  if (o.condition !== 'all') o.condition = 'cib';
  o.zip = /^\d{5}$/.test(String(o.zip || '').trim()) ? String(o.zip).trim() : '';
  ['threshold', 'minSave', 'notifyBelow', 'auctionHours', 'minSellerPct', 'minSellerFb', 'pickupRadius', 'pickupBonus', 'businessMalus'].forEach(k => {
    const v = Number(o[k]); o[k] = isFinite(v) ? v : DEFAULT_OPTS[k];
  });
  return o;
}

// Firestore-sichere Doc-ID aus eBay-itemId ("v1|123|0")
export function dealId(itemId) { return String(itemId).replace(/[^A-Za-z0-9_-]/g, '_'); }

// Liste der Suchaufträge für einen Nutzer (stabil sortiert, damit der Cursor reihum läuft)
export function buildTasks(brauchen, opts) {
  const tasks = [];
  const plats = Object.keys(brauchen || {}).sort();
  for (const platform of plats) {
    const games = [...new Set((brauchen[platform] || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    for (const game of games) {
      tasks.push({ kind: 'new', platform, game });
      tasks.push({ kind: 'end', platform, game });
    }
    if (opts.zip && games.length && PLATFORM_QUERY[platform]) {
      tasks.push({ kind: 'pickup', platform, games });
    }
    if (opts.konvolut && games.length && platform !== 'Konsole/Parts' && PLATFORM_QUERY[platform] !== undefined) {
      tasks.push({ kind: 'konvolut', platform, games });
    }
  }
  return tasks;
}
