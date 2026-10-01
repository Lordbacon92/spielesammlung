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
  ['Xbox', /\bxbox\b/],
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
  if (platform === 'Konsole/Parts' || !PLAT_PATTERNS.some(([p]) => p === platform)) return true;
  const found = [...detectPlatforms(itemTitle)];
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
  'hulle fur', 'huelle fuer', 'case fur', 'case fuer', 'nur cover', 'reparatur', 'repair', 'kabel only', 'nur kabel'
];

// Hinweise auf "nicht komplett" – im OVP-Modus immer raus
const INCOMPLETE = [
  'disc only', 'disk only', 'cd only', 'dvd only', 'nur disc', 'nur disk', 'nur cd', 'nur dvd', 'nur die disc', 'nur die cd',
  'nur modul', 'modul only', 'cartridge only', 'cart only', 'nur cartridge', 'nur das spiel', 'nur spiel', 'game only',
  'lose', 'loose', 'ohne ovp', 'ohne box', 'ohne karton', 'ohne anleitung', 'ohne hulle', 'ohne huelle', 'ohne case',
  'ohne verpackung', 'ohne originalverpackung', 'ohne manual', 'no box', 'no manual', 'no case', 'unboxed',
  'nur ovp', 'ovp fehlt', 'anleitung fehlt', 'hulle fehlt', 'huelle fehlt', 'ohne inlay', 'kein ovp', 'keine ovp', 'keine anleitung'
];
// Positive Hinweise auf komplett mit OVP
const COMPLETE_RE = / (ovp|cib|komplett|kompl|complete|completed|vollstandig|vollstaendig|boxed|in box|mit box|mit karton|originalverpackung|original verpackung|mit anleitung|mit hulle|mit huelle|mit case|in hulle|in huelle|sealed|versiegelt|eingeschweisst|neu ovp|new sealed) /;
export function incompleteReason(itemTitle) {
  const n = ' ' + norm(itemTitle) + ' ';
  for (const w of INCOMPLETE) if (n.includes(' ' + w + ' ')) return w;
  return null;
}
export function looksComplete(itemTitle, conditionId) {
  if (incompleteReason(itemTitle)) return false;
  const n = ' ' + norm(itemTitle) + ' ';
  return COMPLETE_RE.test(n) || String(conditionId) === '1000';   // 1000 = Neu (originalverpackt)
}
const REGION = ['ntsc', 'ntsc j', 'ntsc u', 'jap', 'japan', 'japanisch', 'jpn', 'us import', 'usa', 'us version', 'ntscu', 'ntscj'];

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
export function evaluate(p, ref, target, opts, nowMs) {
  if (!isFinite(p.price) || p.price <= 0) return null;
  const med = ref && ref.median ? ref.median : null;
  if (!med && !target) return null;                         // ohne Vergleichswert keine Aussage
  const base = med || target;
  const score = p.total / base;
  const save = base - p.total;
  let hit = false;
  if (target && p.total <= target) hit = true;
  if (med && score <= opts.threshold && save >= opts.minSave) hit = true;
  if (p.type === 'auction') {
    const left = p.endsAt ? (Date.parse(p.endsAt) - nowMs) / 3600000 : Infinity;
    if (!(left > 0 && left <= opts.auctionHours)) hit = false;   // nur kurz vor Ende interessant
  }
  if (!hit) return null;
  return {
    ref: med ? r2(med) : null,
    refN: ref ? ref.n : 0,
    target: target || null,
    score: Math.round(score * 100) / 100,
    save: r2(save),
    suspicious: !!(med && score < 0.2 && med >= 20)          // zu gut, um wahr zu sein?
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
  condition: 'cib'         // 'cib' = nur komplett mit OVP, 'all' = auch lose Module/Discs
};
export function userOpts(dealScan) {
  const o = Object.assign({}, DEFAULT_OPTS, dealScan || {});
  if (o.condition !== 'all') o.condition = 'cib';
  ['threshold', 'minSave', 'notifyBelow', 'auctionHours', 'minSellerPct', 'minSellerFb'].forEach(k => {
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
    if (opts.konvolut && games.length && platform !== 'Konsole/Parts' && PLATFORM_QUERY[platform] !== undefined) {
      tasks.push({ kind: 'konvolut', platform, games });
    }
  }
  return tasks;
}
