// COLLECT Deal-Scanner – läuft als GitHub Action (siehe .github/workflows/deal-scanner.yml)
// Sucht für jeden Titel der Brauchen-Liste auf eBay.de nach Angeboten deutlich unter Marktpreis
// und legt Treffer unter users/{uid}/deals ab. Optional Push über ntfy.sh.
import {
  PLATFORM_QUERY, CAT_GAMES, buildQuery, titleMatches, platformOk, detectPlatforms, junkReason, conditionClass,
  median, parseItem, sellerOk, evaluate, userOpts, dealId, buildTasks, conditionOk, variantReason, quantile, contextReason,
  descriptionReason, htmlToText, norm, aliasNames, matchGame, typoVariants, fixTypos, foreignWords, learnedBlock, AUFL_WORDS
} from './lib.mjs';

const REF_MAX_AGE = 14 * 864e5;       // Referenzpreis bleibt 14 Tage gültig
const DEAL_TTL = 3 * 864e5;           // nicht mehr gesehene Angebote nach 3 Tagen entfernen

// ── eBay ────────────────────────────────────────────────────────────────────
export function makeEbay({ clientId, clientSecret, zip }) {
  let token = null, tokenExp = 0, calls = 0;
  async function getToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
      },
      body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope')
    });
    if (!res.ok) throw new Error('eBay-Token fehlgeschlagen: ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const j = await res.json();
    token = j.access_token; tokenExp = Date.now() + (j.expires_in || 7200) * 1000;
    return token;
  }
  async function search({ q, sort, auctionOnly, category, limit, pickup }) {
    const filters = pickup
      ? ['pickupCountry:DE', 'pickupPostalCode:' + pickup.zip, 'pickupRadius:' + pickup.radius, 'pickupRadiusUnit:km',
         'deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP}', 'priceCurrency:EUR']
      : ['deliveryCountry:DE', 'priceCurrency:EUR'];
    if (auctionOnly) filters.push('buyingOptions:{AUCTION}');
    const params = new URLSearchParams({ q, limit: String(limit || 200), filter: filters.join(',') });
    if (sort) params.set('sort', sort);
    if (category) params.set('category_ids', category);
    const url = 'https://api.ebay.com/buy/browse/v1/item_summary/search?' + params.toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      calls++;
      const res = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + await getToken(),
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE',
          'X-EBAY-C-ENDUSERCTX': 'contextualLocation=' + encodeURIComponent('country=DE' + (zip ? ',zip=' + zip : '')),
          'Accept-Language': 'de-DE'
        }
      });
      if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
      if (!res.ok) throw new Error('eBay-Suche ' + res.status + ': ' + (await res.text()).slice(0, 200));
      const j = await res.json();
      return j.itemSummaries || [];
    }
    throw new Error('eBay-Suche: zu viele Fehlversuche');
  }
  async function getItem(itemId) {
    const url = 'https://api.ebay.com/buy/browse/v1/item/' + encodeURIComponent(itemId);
    for (let attempt = 0; attempt < 3; attempt++) {
      calls++;
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + await getToken(), 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE', 'Accept-Language': 'de-DE' } });
      if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
      if (res.status === 404) return null;                       // Angebot schon weg
      if (!res.ok) throw new Error('eBay-Artikel ' + res.status);
      return res.json();
    }
    throw new Error('eBay-Artikel: zu viele Fehlversuche');
  }
  return { search, getItem, get calls() { return calls; } };
}

// ── Ein Nutzer ──────────────────────────────────────────────────────────────
// store: { getState, setState, listDeals, writeDeals(upserts, deletes) }
export async function scanUser({ userDoc, store, ebay, budget, now = Date.now(), log = console.log }) {
  const opts = userOpts(userDoc.dealScan);
  const targets = (userDoc.dealScan && userDoc.dealScan.targets) || {};
  const brauchen = (userDoc.data && userDoc.data.Brauchen) || {};
  const ds = userDoc.dealScan || {};
  const aliases = ds.aliases || {};
  const favs = Object.keys(ds.favs || {}).filter(k => ds.favs[k]);
  const state = Object.assign({ cursor: 0, refs: {} }, await store.getState());
  const learn = state.learn || {};                       // k → { words: [], tight: Zahl }
  const nameCache = {};
  const namesFor = (platform, game) => nameCache[platform + '::' + game] || (nameCache[platform + '::' + game] = aliasNames(game, aliases[platform + '::' + game]));
  const badItems = state.badItems || {};                 // itemId → Zeitpunkt (Beschreibung durchgefallen)
  const refs = state.refVersion === 2 ? (state.refs || {}) : {};       // v2: 40-%-Quantil, ohne Sonderausgaben
  // Tippfehler-Suche für wertvolle Titel und Favoriten
  const typoKeys = new Set(favs);
  for (const p of Object.keys(brauchen)) for (const g of brauchen[p] || []) {
    const k = p + '::' + g;
    const r = refs[k + '|cib'] || refs[k + '|modul'] || refs[k + '|sealed'];
    if ((r && r.median >= 30) || Number((ds.targets || {})[k]) >= 30) typoKeys.add(k);
  }
  const tasks = buildTasks(brauchen, opts, { aliases, typoKeys });
  const existing = await store.listDeals();            // Map dealId → doc
  // Aus „Ausblenden mit Grund“ lernen
  const learnedUpd = [];
  for (const [id, d] of existing) {
    if (d.status !== 'hidden' || !d.hideReason || d.learned || d.kind === 'konvolut') continue;
    const k = d.platform + '::' + d.game;
    const L = learn[k] = learn[k] || { words: [] };
    if (d.hideReason === 'wrong') {
      L.words = [...new Set([...L.words, ...foreignWords(d.title, d.game).slice(0, 4)])].slice(-30);
    } else if (d.hideReason === 'expensive' && d.score) {
      L.tight = Math.min(L.tight || 9, Math.max(0.25, d.score - 0.05));
    } else if (d.hideReason === 'incomplete') {
      badItems[d.itemId] = now;
    }
    learnedUpd.push(id);
  }
  const found = new Map();                             // dealId → deal (dieser Lauf)
  const seen = new Set();
  let used = 0, done = 0, cursor = state.cursor % Math.max(1, tasks.length);
  const stats = { tasks: 0, items: 0, matched: 0, deals: 0, errors: 0 };

  function refFor(platform, game, cls) {
    const r = refs[platform + '::' + game + '|' + cls];
    return r && now - r.at < REF_MAX_AGE ? r : null;
  }
  function setRef(platform, game, cls, med, n) {
    const k = platform + '::' + game + '|' + cls;
    const prev = refs[k];
    let m = med;
    if (prev && now - prev.at < REF_MAX_AGE && n < 8) m = (prev.median + med) / 2;   // wenig Daten → glätten
    refs[k] = { median: Math.round(m * 100) / 100, n, at: now };
  }
  function filterMatched(items, platform, game, mode) {
    const out = [];
    const names = namesFor(platform, game);
    const typo = mode && mode.typo;
    const L = learn[platform + '::' + game];
    for (const raw of items) {
      const p = parseItem(raw);
      if (mode && mode.nocat && (raw.categories || []).some(c => String(c.categoryId) === CAT_GAMES)) continue;   // schon in der normalen Suche
      const mt = typo ? fixTypos(p.title, typo) : p.title;
      const nm = matchGame(mt, names);
      if (!nm) continue;
      if (!platformOk(p.title, platform, false)) continue;
      if (mode && mode.nocat && !detectPlatforms(p.title).size) continue;   // außerhalb der Kategorie muss die Plattform dastehen
      if (junkReason(p.title, nm, opts)) continue;
      if (variantReason(mt, nm)) continue;
      if (learnedBlock(p.title, L)) continue;
      if (!sellerOk(p, opts)) continue;
      p.cls = conditionClass(p.title, platform, p.conditionId);
      p.condOk = conditionOk(p.title, p.conditionId, opts);
      out.push(p);
    }
    return out;
  }
  const candidates = [];
  function addDeal(p, extra) { candidates.push([p, extra]); }
  function acceptDeal(p, extra) {
    const id = dealId(p.itemId);
    seen.add(id);
    found.set(id, Object.assign({}, p, extra));
  }

  const searchBudget = Math.floor(budget * 0.8);           // Rest für Beschreibungen
  // Favoriten: in jedem Lauf neue Angebote prüfen (max. 15)
  const favTasks = favs.slice(0, 15).map(k => { const i = k.indexOf('::'); return { kind: 'new', platform: k.slice(0, i), game: k.slice(i + 2), fav: true }; })
    .filter(t => (brauchen[t.platform] || []).includes(t.game));
  let fi = 0;
  stats.favs = favTasks.length;
  while (used < searchBudget && (fi < favTasks.length || done < tasks.length)) {
    let t;
    if (fi < favTasks.length) t = favTasks[fi++];
    else { t = tasks[cursor]; cursor = (cursor + 1) % tasks.length; done++; if (t.kind === 'new' && favs.includes(t.platform + '::' + t.game)) continue; }
    try {
      const parts = t.platform === 'Konsole/Parts';
      if (t.kind === 'new' || t.kind === 'end' || t.kind === 'nocat' || t.kind === 'alias' || t.kind === 'typo') {
        let q, mode = null, src = null;
        if (t.kind === 'alias') { q = buildQuery(t.alias, t.platform); src = 'alias'; }
        else if (t.kind === 'typo') {
          const ty = typoVariants(t.game);
          if (!ty) continue;
          const rest = buildQuery(t.game, t.platform).split(' ').filter(w => norm(w) !== ty.word).join(' ');
          q = '(' + ty.variants.join(', ') + ') ' + rest;
          mode = { typo: ty }; src = 'typo';
        } else q = buildQuery(t.game, t.platform);
        if (t.kind === 'nocat') { mode = { nocat: true }; src = 'nocat'; }
        const items = await ebay.search({
          q,
          sort: t.kind === 'end' ? 'endingSoonest' : 'newlyListed',
          auctionOnly: t.kind === 'end',
          category: parts || t.kind === 'nocat' ? null : CAT_GAMES,
          limit: t.kind === 'new' ? 200 : 100
        });
        used++; stats.tasks++; stats.items += items.length;
        const matched = filterMatched(items, t.platform, t.game, mode);
        stats.matched += matched.length;
        if (t.kind === 'new') {
          // Marktreferenz: Median der Sofortkauf-Gesamtpreise je Zustand
          const byCls = {};
          matched.filter(p => p.type === 'bin').forEach(p => { (byCls[p.cls] = byCls[p.cls] || []).push(p.total); });
          for (const [cls, arr] of Object.entries(byCls)) if (arr.length >= 5) setRef(t.platform, t.game, cls, quantile(arr, 0.4), arr.length);
        }
        const target = Number(targets[t.platform + '::' + t.game]) || null;
        for (const p of matched) {
          if (!p.condOk) continue;
          const ev = evaluate(p, refFor(t.platform, t.game, p.cls), target, opts, now);
          if (!ev) continue;
          const L = learn[t.platform + '::' + t.game];
          if (L && L.tight && ev.ref && ev.score > L.tight && !(ev.target && p.total <= ev.target)) continue;   // gelernt: zu teuer
          addDeal(p, Object.assign({ kind: 'title', platform: t.platform, game: t.game, src: src || (t.fav ? 'fav' : null), fav: !!t.fav || favs.includes(t.platform + '::' + t.game) }, ev));
        }
      } else if (t.kind === 'konvolut' || t.kind === 'pickup' || t.kind === 'aufl') {
        const pickup = t.kind === 'pickup';
        const items = await ebay.search(pickup
          ? { q: PLATFORM_QUERY[t.platform], sort: 'newlyListed', category: t.platform === 'Konsole/Parts' ? null : CAT_GAMES, limit: 200, pickup: { zip: opts.zip, radius: opts.pickupRadius } }
          : t.kind === 'aufl'
            ? { q: PLATFORM_QUERY[t.platform] + ' ' + AUFL_WORDS, sort: 'newlyListed', category: null, limit: 100 }
            : { q: 'Konvolut ' + PLATFORM_QUERY[t.platform], sort: 'newlyListed', category: CAT_GAMES, limit: 100 });
        used++; stats.tasks++; stats.items += items.length;
        for (const raw of items) {
          const p = parseItem(raw);
          if (pickup) { p.pickup = true; p.shipping = 0; p.shipKnown = true; p.total = p.price; }
          if (!platformOk(p.title, t.platform, true)) continue;
          if (junkReason(p.title, '', opts) || !sellerOk(p, opts)) continue;
          if (!conditionOk(p.title, p.conditionId, opts)) continue;
          if (!isFinite(p.price) || p.price <= 0) continue;
          const hits = t.games.filter(g => namesFor(t.platform, g).some(nm => titleMatches(p.title, nm)));
          if (!hits.length) continue;
          stats.matched++;
          const cls = conditionClass(p.title, t.platform, p.conditionId);
          p.cls = cls;
          // Genau ein Titel: wie eine normale Suche bewerten (Abholung etwas großzügiger)
          if (hits.length === 1) {
            const g = hits[0];
            const names = namesFor(t.platform, g);
            const nm = pickup ? matchGame(p.title, names) : names.find(x => titleMatches(p.title, x));   // bei Auflösungen stehen andere Wörter daneben
            if (!nm || (pickup && variantReason(p.title, nm)) || learnedBlock(p.title, learn[t.platform + '::' + g]) || !platformOk(p.title, t.platform, !pickup)) continue;
            const ev = evaluate(p, refFor(t.platform, g, cls), Number(targets[t.platform + '::' + g]) || null, opts, now, pickup ? opts.pickupBonus : 0);
            if (ev) addDeal(p, Object.assign({ kind: 'title', platform: t.platform, game: g, src: t.kind === 'aufl' ? 'aufl' : null }, ev));
            continue;
          }
          let sum = 0, known = 0;
          for (const g of hits) {
            const r = refFor(t.platform, g, cls) || refFor(t.platform, g, 'modul');
            const tg = Number(targets[t.platform + '::' + g]) || null;
            const v = r ? r.median : tg;
            if (v) { sum += v; known++; }
          }
          if (!known) continue;
          if (p.type === 'auction') {
            const left = p.endsAt ? (Date.parse(p.endsAt) - now) / 3600000 : Infinity;
            if (!(left > 0 && left <= opts.auctionHours)) continue;
          }
          const score = p.total / sum, save = sum - p.total;
          if (score > (pickup ? 1 + opts.pickupBonus : 1) || save < opts.minSave) continue;
          addDeal(p, {
            kind: 'konvolut', src: t.kind === 'aufl' ? 'aufl' : null, platform: t.platform, game: hits.join(' · '), matched: hits, cls,
            ref: Math.round(sum * 100) / 100, refN: known, target: null,
            score: Math.round(score * 100) / 100, save: Math.round(save * 100) / 100, suspicious: false, offer: null
          });
        }
      }
    } catch (e) {
      stats.errors++;
      log('  ! ' + t.kind + ' ' + (t.game || t.platform) + ': ' + e.message);
      if (/Token/.test(e.message)) throw e;
    }
  }

  // ── Beschreibung der Kandidaten prüfen ──
  const descBudget = Math.max(0, budget - used);
  let descCalls = 0;
  stats.descChecked = 0; stats.descRejected = 0;
  const checked = new Set();
  for (const [p, extra] of candidates) {
    const id = dealId(p.itemId);
    if (checked.has(id)) continue;
    checked.add(id);
    const old = existing.get(id);
    if (badItems[p.itemId]) continue;
    if (old && old.descOk) { acceptDeal(p, Object.assign({ descOk: true, sellerType: old.sellerType || '' }, extra)); continue; }
    if (!ebay.getItem || descCalls >= descBudget) { if (old) seen.add(id); continue; }   // nächster Lauf
    try {
      descCalls++; used++; stats.descChecked++;
      const it = await ebay.getItem(p.itemId);
      if (!it) { badItems[p.itemId] = now; continue; }
      const text = [it.conditionDescription, it.shortDescription, htmlToText(it.description)].filter(Boolean).join(' . ');
      const why = descriptionReason(text, opts);
      if (why) { badItems[p.itemId] = now; stats.descRejected++; continue; }
      const sellerType = it.seller && it.seller.sellerAccountType ? String(it.seller.sellerAccountType).toUpperCase() : '';
      if (sellerType === 'BUSINESS' && !extra.offer && extra.ref && extra.kind !== 'konvolut' &&
          extra.score > opts.threshold + (p.pickup ? opts.pickupBonus : 0) - opts.businessMalus &&
          !(extra.target && p.total <= extra.target)) {
        badItems[p.itemId] = now; stats.descRejected++; continue;               // Händler: nur bei deutlich besserem Preis
      }
      if (p.pickup && it.itemLocation && it.itemLocation.city) p.city = it.itemLocation.city;
      acceptDeal(p, Object.assign({ descOk: true, sellerType }, extra));
    } catch (e) { stats.errors++; log('  ! Beschreibung ' + p.itemId + ': ' + e.message); if (old) seen.add(id); }
  }
  for (const k of Object.keys(badItems)) if (now - badItems[k] > 14 * 864e5) delete badItems[k];

  for (const id of learnedUpd) if (found.has(id)) found.get(id).learned = true;
  // ── Schreiben ──
  const upserts = [], deletes = [], fresh = [];
  for (const [id, d] of found) {
    const old = existing.get(id);
    const doc = Object.assign({}, d, { lastSeen: now });
    if (!old) { doc.firstSeen = now; doc.status = 'new'; fresh.push(doc); }
    upserts.push([id, doc, !old]);
  }
  for (const [id, old] of existing) {
    if (found.has(id)) continue;
    if (badItems[old.itemId]) { deletes.push(id); continue; }
    if (seen.has(id)) continue;                          // Beschreibung noch nicht geprüft – behalten
    const stale = junkReason(old.title || '', old.kind === 'konvolut' ? '' : (old.game || ''), opts) ||
      !conditionOk(old.title || '', old.conditionId, opts) || old.cls === 'std' ||
      (old.kind !== 'konvolut' && (variantReason(old.title || '', old.game || '') || contextReason(old.title || '', old.game || '') || !platformOk(old.title || '', old.platform, false) || (old.ref && old.score < 0.25)));
    if (stale) { deletes.push(id); continue; }
    const ended = old.endsAt && Date.parse(old.endsAt) < now - 3600000;
    if (ended || now - (old.lastSeen || 0) > DEAL_TTL) deletes.push(id);
  }
  for (const id of learnedUpd) if (!found.has(id) && !deletes.includes(id)) upserts.push([id, { learned: true }, false]);
  stats.deals = found.size;
  await store.writeDeals(upserts, deletes);
  if (store.setStatus) await store.setStatus({ lastRun: now, lastStats: Object.assign({ calls: used, total: tasks.length }, stats) }).catch(e => log('  ! Status: ' + e.message));
  await store.setState({ cursor, refs, badItems, learn, refVersion: 2, lastRun: now, lastStats: Object.assign({ calls: used, total: tasks.length, newDeals: fresh.length }, stats) });

  // ── Push ──
  const notify = fresh.filter(d => d.score <= opts.notifyBelow || (d.target && d.total <= d.target)).sort((a, b) => a.score - b.score);
  return { stats, used, fresh, notify, opts };
}

export async function sendNtfy(topic, deals, fetchFn = fetch) {
  if (!topic || !deals.length) return;
  const fmt = n => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const list = deals.slice(0, 4);
  for (const d of list) {
    const pct = Math.round(d.score * 100);
    await fetchFn('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title: (d.kind === 'konvolut' ? 'Konvolut: ' : '') + d.game + ' (' + d.platform + ') – ' + fmt(d.total),
        message: d.title + '\n' + (d.ref ? pct + ' % vom Marktpreis (~' + fmt(d.ref) + ')' : 'Unter deinem Zielpreis') +
          (d.type === 'auction' ? ' · Auktion, ' + d.bids + ' Gebote' : ' · Sofortkauf'),
        click: d.url,
        tags: ['video_game'],
        priority: d.score <= 0.4 ? 5 : 4
      })
    }).catch(() => {});
  }
  if (deals.length > list.length) {
    await fetchFn('https://ntfy.sh/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title: 'COLLECT', message: '+' + (deals.length - list.length) + ' weitere Deals – öffne den Deals-Tab', tags: ['video_game'] })
    }).catch(() => {});
  }
}

// ── Firestore ───────────────────────────────────────────────────────────────
function firestoreStore(db, uid) {
  const userRef = db.collection('users').doc(uid);
  const stateRef = userRef.collection('dealMeta').doc('state');
  const dealsCol = userRef.collection('deals');
  return {
    async getState() { const s = await stateRef.get(); return s.exists ? s.data() : {}; },
    async setState(st) { await stateRef.set(st); },
    async setStatus(st) { await userRef.update({ dealStatus: st }); },
    async listDeals() { const q = await dealsCol.get(); return new Map(q.docs.map(d => [d.id, d.data()])); },
    async writeDeals(upserts, deletes) {
      const ops = [];
      for (const [id, doc, isNew] of upserts) {
        if (!isNew) { delete doc.status; delete doc.firstSeen; }   // Status (z. B. ausgeblendet) nicht überschreiben
        ops.push(b => b.set(dealsCol.doc(id), doc, { merge: true }));
      }
      for (const id of deletes) ops.push(b => b.delete(dealsCol.doc(id)));
      for (let i = 0; i < ops.length; i += 400) {
        const b = db.batch();
        ops.slice(i, i + 400).forEach(f => f(b));
        await b.commit();
      }
    }
  };
}

async function main() {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.project_id) throw new Error('Secret FIREBASE_SERVICE_ACCOUNT fehlt');
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) throw new Error('Secrets EBAY_CLIENT_ID / EBAY_CLIENT_SECRET fehlen');
  initializeApp({ credential: cert(sa) });
  const db = getFirestore();
  const ebay = makeEbay({ clientId: process.env.EBAY_CLIENT_ID, clientSecret: process.env.EBAY_CLIENT_SECRET, zip: process.env.EBAY_ZIP || '' });

  const users = await db.collection('users').where('dealScan.enabled', '==', true).get();
  if (users.empty) { console.log('::warning::Kein Nutzer hat den Deal-Scanner aktiviert (dealScan.enabled)'); return; }
  const totalBudget = Number(process.env.MAX_CALLS || 100);
  const per = Math.max(10, Math.floor(totalBudget / users.size));
  for (const u of users.docs) {
    console.log('Nutzer ' + u.id.slice(0, 6) + '… (Budget ' + per + ' Abfragen)');
    const res = await scanUser({ userDoc: u.data(), store: firestoreStore(db, u.id), ebay, budget: per });
    console.log('::notice::Nutzer ' + u.id.slice(0, 6) + ': ' + JSON.stringify(res.stats) + ' neu=' + res.fresh.length);
    if (process.env.DEBUG_DEALS) res.fresh.slice(0, 40).forEach(d => console.log('::notice::DEAL ' + [d.platform, d.game, d.cls, d.type, d.total, d.ref, d.refN, d.score, d.title].join(' | ')));
    if (res.opts.ntfyTopic) await sendNtfy(res.opts.ntfyTopic, res.notify);
  }
  console.log('eBay-Abfragen gesamt: ' + ebay.calls);
}

if (import.meta.url === 'file://' + process.argv[1]) {
  main().catch(e => { console.error(e); console.log('::error::' + String(e && e.message || e).replace(/\n/g, ' ')); process.exit(1); });
}
