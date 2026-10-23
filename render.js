// Сборка index.html из content.json.
// Один и тот же код работает в Node (build.mjs) и в браузере (предпросмотр и публикация из админки).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ESC[ch]);

export const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
export const tgHref = t => 'https://t.me/' + String(t || '').replace(/^@/, '').trim();
const tgName = t => '@' + String(t || '').replace(/^@/, '').trim();

// Подстановки в любом тексте: {телефон} {max} {telegram} {почта}
function tokens(s, c) {
  const k = c.contacts || {};
  return String(s ?? '')
    .replace(/\{телефон\}/gi, k.phone || '')
    .replace(/\{max\}|\{макс\}/gi, k.max || '')
    .replace(/\{telegram\}|\{телеграм\}/gi, k.telegram ? tgName(k.telegram) : '')
    .replace(/\{почта\}|\{email\}/gi, k.email || '');
}

// Разметка строки: *курсив*, **жирный**, [текст](ссылка), перенос строки → <br>
export function inline(s, c) {
  let h = esc(tokens(s, c));
  // в ссылках допускаются только обычные адреса: http(s), почта, телефон, якорь, путь внутри сайта
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => !/^(https?:|mailto:|tel:|#|\/|[\w.-]+(\/|$))/i.test(u) ? t :
    `<a href="${u}"${/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return h.replace(/\n/g, '<br>');
}
// Абзацы разделяются пустой строкой; класс first — только первому абзацу
function paras(s, c, first = '') {
  return String(s || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map((p, i) => `<p${i === 0 && first ? ` class="${first}"` : ''}>${inline(p, c)}</p>`).join('');
}

const SPACE = { '0': ' mt-0', s: ' mt-m', m: ' mt-l', l: ' mt-xl' };
const RATIOS = ['43', '32', '11', '45', '54', '34', '169'];
const ratio = r => ' r' + (RATIOS.includes(String(r)) ? r : '43');
const PHONE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/></svg>';
const ICON = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${d}"/></svg>`;

export function render(c, opt = {}) {
  const asset = opt.asset || (p => p);
  const ed = opt.preview ? v => ` data-ed="${v}"` : () => '';
  const k = c.contacts || {}, b = c.brand || {}, m = c.meta || {};
  const ver = c.build?.v ? '?v=' + c.build.v : '';
  const site = (m.siteUrl || '').replace(/\/?$/, '/');
  const abs = p => !p ? '' : /^https?:/.test(p) ? p : site + p;
  const T = s => inline(s, c);
  const blank = u => /^https?:/.test(u) ? ' target="_blank" rel="noopener"' : '';

  const img = (src, alt, extra = '') => {
    const d = c.dims?.[src];
    return `<img${extra} src="${esc(asset(src))}" alt="${esc(alt)}"${d ? ` width="${d[0]}" height="${d[1]}"` : ''}>`;
  };
  const fig = (src, alt, cls = '') => `<div class="fig fig--z${cls}">${img(src, alt, ' loading="lazy"')}</div>`;
  const book = (cls = 'btn') => `<a class="${cls}" href="${telHref(k.phone)}">${esc(k.bookLabel)}</a>`;
  const ask = (cls = 'btn btn--line') => `<a class="${cls}" href="${tgHref(k.telegram)}" target="_blank" rel="noopener">${esc(k.askLabel)}</a>`;
  const acts = (cls = 'acts') => `<div class="${cls}">${book()}${ask()}</div>`;
  const btn = x => {
    const href = x.link === 'call' ? telHref(k.phone) : x.link === 'ask' ? tgHref(k.telegram) : x.url || '#';
    return `<a class="btn${x.style === 'line' ? ' btn--line' : ''}" href="${esc(href)}"${blank(href)}>${esc(x.label)}</a>`;
  };
  const btns = (list, cls) => list?.length ? `<div class="${cls}">${list.map(btn).join('')}</div>` : '';
  const priceRows = (rows, full) => rows.map(r =>
    `<div class="row"><div><h4>${T(r.title)}</h4>${r.sub ? `<div class="sub">${T(r.sub)}</div>` : ''}</div>` +
    (full ? `<p>${T(r.text)}</p>` : '') +
    `<div class="v">${T(r.price)}${r.note ? `<small>${T(r.note)}</small>` : ''}</div></div>`).join('');

  // ── блоки ─────────────────────────────────────────────
  const B = {
    photo: x => `<div class="bleed rv{sp}">${fig(x.image, x.alt)}</div>`,
    duo(x) {
      const t = [];
      if (x.label) t.push(`<span class="lbl">${T(x.label)}</span>`);
      if (x.h3) t.push(`<h3 class="t3">${T(x.h3)}</h3>`);
      if (x.big) t.push(`<p class="big-say">${T(x.big)}</p>`);
      if (x.lead) t.push(`<p class="lead">${T(x.lead)}</p>`);
      if (x.text) t.push(paras(x.text, c, t.length ? 'mt-s' : ''));
      if (x.accent) t.push(`<p class="ink">${T(x.accent)}</p>`);
      if (x.prices?.length) t.push(`<div class="rows rows--mini">${priceRows(x.prices)}</div>`);
      if (x.steps?.length) t.push(`<ol class="steps">${x.steps.map((s, i) =>
        `<li><span class="n">${i + 1}</span><div><b>${T(s.title)}</b><p>${T(s.text)}</p></div></li>`).join('')}</ol>`);
      t.push(btns(x.buttons, 'acts'));
      const txt = `<div class="duo__txt">${t.join('')}</div>`;
      if (!x.image) return `<div class="txt rv{sp}">${t.join('')}</div>`;
      const f = fig(x.image, x.alt, ratio(x.ratio));
      // side — где фото; wide — какая колонка шире (по умолчанию фото)
      const tw = x.wide === 'text';
      return x.side === 'right'
        ? `<div class="duo${tw ? '' : ' duo--rev'} rv{sp}">${txt}${f}</div>`
        : `<div class="duo${tw ? ' duo--tw' : ''} rv{sp}">${f}${txt}</div>`;
    },
    cols: x => `<div class="cols rv{sp}"><div>${x.leftTitle ? `<h4>${T(x.leftTitle)}</h4>` : ''}<ul>${(x.left || []).map(i => `<li>${T(i)}</li>`).join('')}</ul></div>` +
      `<div class="no">${x.rightTitle ? `<h4>${T(x.rightTitle)}</h4>` : ''}<ul>${(x.right || []).map(i => `<li>${T(i)}</li>`).join('')}</ul></div></div>`,
    prices: x => `<div class="rows rv{sp}">${priceRows(x.rows || [], true)}</div>` + (x.note ? `<p class="note-s rv">${T(x.note)}</p>` : ''),
    features(x) {
      const ul = cls => `<ul class="plist${cls}">${(x.items || []).map(i => `<li><b>${T(i.title)}</b>${i.sub ? `<span>${T(i.sub)}</span>` : ''}</li>`).join('')}</ul>`;
      return x.label ? `<div class="rv{sp}"><span class="lbl">${T(x.label)}</span>${ul('')}</div>` : ul(' rv{sp}');
    },
    mosaic: x => `<div class="mos rv{sp}">${(x.photos || []).map(p =>
      fig(p.image, p.alt, ratio(p.ratio) + (p.size && p.size !== '4' ? ' w' + p.size : ''))).join('')}</div>` +
      ((x.photos || []).length > 2 ? `<div class="swipe">${esc(c.ui?.swipe)}</div>` : ''),
    cards: x => `<div class="dets rv{sp}">${(x.items || []).map(i =>
      `<div class="det"><figure>${fig(i.image, i.alt)}<b>${T(i.title)}</b><span>${T(i.text)}</span></figure></div>`).join('')}</div>`,
    split: x => `<div class="head head--split rv{sp}"><div>${x.label ? `<span class="lbl">${T(x.label)}</span>` : ''}${x.h3 ? `<h3 class="t3">${T(x.h3)}</h3>` : ''}</div><div>${paras(x.text, c)}</div></div>`,
    text: x => `<div class="txt rv{sp}">${x.big ? `<p class="big-say">${T(x.big)}</p>` : ''}${paras(x.text, c, x.big ? 'mt-s' : '')}</div>`,
    buttons: x => btns(x.items, 'acts rv{sp}'),
    reviews: x => (x.rating || x.ratingTitle ? `<div class="rate rv{sp}"><span class="num">${T(x.rating)}</span><span class="of"><b>${T(x.ratingTitle)}</b>${T(x.ratingText)}</span></div>` : '') +
      `<div class="revs rv${x.rating || x.ratingTitle ? '' : '{sp}'}">${(x.items || []).map(r =>
        `<blockquote class="rev"><p>${T(r.text)}</p><cite>${[r.author ? `<b>${esc(r.author)}</b>` : '', esc(r.date), esc(r.source)].filter(Boolean).join(' · ')}</cite></blockquote>`).join('')}</div>`,
    contacts(x) {
      const L = k.labels || {};
      const row = (tag, href, key, v, note, ext = '') => v ? `<${tag}${href ? ` href="${esc(href)}"${ext}` : ''}><span class="k">${esc(L[key] || key)}</span><span class="v">${esc(v)}${note ? `<small>${T(note)}</small>` : ''}</span></${tag}>` : '';
      const cts = row('a', telHref(k.phone), 'phone', k.phone, k.phoneNote) +
        row('div', '', 'max', k.max, k.maxNote) +
        row('a', tgHref(k.telegram), 'telegram', k.telegram && tgName(k.telegram), k.telegramNote, ' target="_blank" rel="noopener"') +
        row('a', 'mailto:' + k.email, 'email', k.email, k.emailNote) +
        row('div', '', 'address', k.address, k.addressNote) +
        row('div', '', 'checkin', k.checkin, k.checkinNote);
      const faq = (x.faq || []).map(q => `<details><summary>${T(q.q)}</summary><div class="a">${T(q.a)}</div></details>`).join('');
      return (x.bigPhone ? `<div class="phone rv{sp}"><a class="phone-xl" href="${telHref(k.phone)}">${esc(k.phone)}</a></div>` : '') +
        `<div class="duo rv${x.bigPhone ? '' : '{sp}'}"><div class="duo__txt"><div class="cts">${cts}</div></div>` +
        (faq ? `<div class="duo__txt"><div class="faq">${faq}</div></div>` : '') + '</div>';
    },
  };

  const block = (x, si, bi) => {
    const fn = B[x.type];
    if (!fn || x.hidden) return '';
    const html = fn(x);
    // {sp} стоит в конце class="…" первого элемента блока: туда идёт отступ,
    // а в предпросмотре ещё и метка data-ed, чтобы клик по блоку открывал его в редакторе
    const mark = opt.preview ? `" data-ed="b:${si}:${bi}` : '';
    return html.replace('{sp}', (SPACE[x.space] || '') + mark).replace(/\{sp\}/g, '');
  };

  const section = (s, si) => {
    if (s.hidden) return '';
    const id = s.id ? ` id="${esc(s.id)}"` : '';
    const bg = s.bg === 'sand' ? ' sec--sand' : '';
    if (s.style === 'final') {
      return `<section class="sec fin${bg}"${id}${ed('s:' + si)}><div class="wrap"><div class="rv">` +
        (s.title ? `<h2 class="t">${T(s.title)}</h2>` : '') + (s.lead ? `<p class="lead">${T(s.lead)}</p>` : '') +
        acts() + `</div>${(s.blocks || []).map((x, bi) => block(x, si, bi)).join('')}</div></section>`;
    }
    let head = '';
    if (s.label || s.title || s.lead) {
      const t = (s.label ? `<span class="lbl">${T(s.label)}</span>` : '') + (s.title ? `<h2 class="t">${T(s.title)}</h2>` : '');
      head = s.lead ? `<div class="head head--split rv"><div>${t}</div><p class="lead">${T(s.lead)}</p></div>` : `<div class="head rv">${t}</div>`;
    }
    return `<section class="sec${bg}"${id}${ed('s:' + si)}><div class="wrap">${head}${(s.blocks || []).map((x, bi) => block(x, si, bi)).join('')}</div></section>`;
  };

  // ── страница ──────────────────────────────────────────
  const nav = c.nav || [];
  const col = c.colors || {};
  const vars = Object.entries({ paper: col.paper, sand: col.sand, ink: col.ink, sage: col.sage, baikal: col.baikal })
    .filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(v || '')).map(([n, v]) => `--${n}:${v}`).join(';');
  const h = c.hero || {}, f = c.footer || {}, sc = c.schema || {};
  const year = opt.year || new Date().getFullYear();

  const ld = {
    '@context': 'https://schema.org', '@type': sc.type || 'LodgingBusiness', name: sc.name || m.siteName,
    alternateName: (sc.alternateName || '').split(',').map(s => s.trim()).filter(Boolean),
    description: sc.description || m.description, url: site, image: abs(m.ogImage),
    telephone: (k.phone || '').replace(/\s+/g, '-'), email: k.email || undefined,
    sameAs: [k.telegram && tgHref(k.telegram), ...(sc.sameAs || '').split(/[\s,]+/)].filter(Boolean),
    aggregateRating: sc.ratingValue ? { '@type': 'AggregateRating', ratingValue: sc.ratingValue, reviewCount: sc.reviewCount, bestRating: '5', worstRating: '1' } : undefined,
    priceRange: sc.priceRange || undefined, currenciesAccepted: 'RUB',
    numberOfRooms: sc.numberOfRooms ? Number(sc.numberOfRooms) || sc.numberOfRooms : undefined,
    petsAllowed: sc.petsAllowed || undefined, checkinTime: sc.checkinTime || undefined, checkoutTime: sc.checkoutTime || undefined,
    address: { '@type': 'PostalAddress', streetAddress: sc.streetAddress, addressLocality: sc.locality, addressRegion: sc.region, addressCountry: sc.country },
    amenityFeature: (sc.amenities || []).filter(Boolean).map(name => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
    makesOffer: (sc.offers || []).filter(o => o.name).map(o => ({ '@type': 'Offer', name: o.name, price: o.price, priceCurrency: 'RUB', description: o.description })),
  };

  return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
    (opt.base ? `<base href="${esc(opt.base)}">` : '') +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    `<title>${esc(m.title)}</title><meta name="description" content="${esc(m.description)}">` +
    (m.keywords ? `<meta name="keywords" content="${esc(m.keywords)}">` : '') +
    `<meta name="theme-color" content="${esc(col.paper || '#F5F1E8')}"><meta name="format-detection" content="telephone=no">` +
    (site !== '/' ? `<link rel="canonical" href="${esc(site)}"><meta property="og:url" content="${esc(site)}">` : '') +
    `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(m.siteName)}">` +
    `<meta property="og:title" content="${esc(m.ogTitle || m.title)}"><meta property="og:description" content="${esc(m.ogDescription || m.description)}">` +
    (m.ogImage ? `<meta property="og:image" content="${esc(abs(m.ogImage))}">` + (c.dims?.[m.ogImage] ? `<meta property="og:image:width" content="${c.dims[m.ogImage][0]}"><meta property="og:image:height" content="${c.dims[m.ogImage][1]}">` : '') : '') +
    '<meta name="twitter:card" content="summary_large_image"><meta property="og:locale" content="ru_RU">' +
    `<link rel="icon" type="image/png" href="${esc(asset(b.favicon || 'favicon.png'))}"><link rel="apple-touch-icon" href="${esc(asset(b.touchIcon || 'apple-touch-icon.png'))}">` +
    '<link rel="preload" href="assets/fonts/manrope-cyr.woff2" as="font" type="font/woff2" crossorigin>' +
    '<link rel="preload" href="assets/fonts/cormorant-cyr.woff2" as="font" type="font/woff2" crossorigin>' +
    `<link rel="stylesheet" href="assets/style.css${ver}">` + (vars ? `<style>:root{${vars}}</style>` : '') +
    (opt.preview ? '<style>.js .rv{opacity:1!important;transform:none!important}[data-ed]{cursor:pointer}[data-ed]:hover:not(:has([data-ed]:hover)){outline:2px dashed rgba(53,69,74,.45);outline-offset:-2px}</style>' : '') +
    `<script>document.documentElement.className='js'+(window.self!==window.top?' embed':'')</script>` +
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` +
    '</head><body>' +
    // шапка
    `<header class="hdr" id="hdr"${ed('header')}><div class="wrap"><a class="logo" href="#top" aria-label="${esc(b.name)} — наверх">${img(b.logo, '', '')}` +
    `<span><span class="nm">${esc(b.name)}</span><span class="sb">${esc(b.tagline)}</span></span></a>` +
    `<nav class="nav" aria-label="Основное меню">${nav.filter(n => n.header).map(n => `<a href="${esc(n.href)}">${esc(n.short || n.long)}</a>`).join('')}</nav>` +
    `${book('cta')}<button class="burger" id="burger" aria-label="Меню" aria-expanded="false"><i></i></button></div></header>` +
    `<nav class="mnav" id="mnav" aria-label="Мобильное меню">${nav.filter(n => n.mobile).map(n => `<a href="${esc(n.href)}">${esc(n.long || n.short)}</a>`).join('')}${acts()}</nav>` +
    // первый экран
    `<section class="hero" id="top"${ed('hero')}><div class="wrap"><div class="hero__grid"><div class="hero__txt">` +
    (b.emblem ? img(b.emblem, b.emblemAlt, ' class="emblem"') : '') +
    (h.kicker ? `<div class="kick">${T(h.kicker)}</div>` : '') + `<h1>${T(h.title)}</h1>${acts()}</div>` +
    `<div class="hero__pic"><div class="ph fig fig--z">${img(h.image, h.alt, ' fetchpriority="high"')}</div>` +
    (h.caption ? `<div class="hero__cap">${T(h.caption)}</div>` : '') + '</div></div></div></section>' +
    // разделы
    (c.sections || []).map(section).join('') +
    // подвал
    `<footer class="foot"${ed('footer')}><div class="wrap"><div class="foot__top"><div>` +
    (b.emblem ? `<a href="#top" aria-label="${esc(b.name)} — наверх">${img(b.emblem, '', ' class="emblem-f" loading="lazy"')}</a>` : '') +
    (f.about ? `<p class="mut">${T(f.about)}</p>` : '') + '</div>' +
    `<div><h5>${esc(f.sectionsTitle)}</h5><ul>${nav.filter(n => n.footer).map(n => `<li><a href="${esc(n.href)}">${esc(n.long || n.short)}</a></li>`).join('')}</ul></div>` +
    `<div><h5>${esc(f.contactsTitle)}</h5><ul>` +
    (k.phone ? `<li><a href="${telHref(k.phone)}">${esc(k.phone)}</a></li>` : '') +
    (k.max ? `<li class="mut">MAX · ${esc(k.max)}</li>` : '') +
    (k.telegram ? `<li><a href="${tgHref(k.telegram)}" target="_blank" rel="noopener">Telegram · ${esc(tgName(k.telegram))}</a></li>` : '') +
    (k.email ? `<li><a href="mailto:${esc(k.email)}">${esc(k.email)}</a></li>` : '') +
    (k.addressShort ? `<li class="mut">${T(k.addressShort)}</li>` : '') +
    (k.checkinShort ? `<li class="mut">${T(k.checkinShort)}</li>` : '') +
    `</ul></div></div><div class="bot"><span>© <span id="yr">${year}</span> ${T(f.copyright)}</span>${f.disclaimer ? `<span>${T(f.disclaimer)}</span>` : ''}</div></div></footer>` +
    // панель на телефоне и лайтбокс
    `<div class="bar" id="bar"><a class="call" href="${telHref(k.phone)}">${PHONE_SVG}${esc(k.bookLabel)}</a>${ask('ask')}</div>` +
    '<div class="lb" id="lb" hidden><img id="lbImg" alt="" hidden>' +
    `<button class="lb__x" id="lbX" aria-label="Закрыть">${ICON('M5 5l14 14M19 5 5 19')}</button>` +
    `<button class="lb__p" id="lbP" aria-label="Предыдущее фото">${ICON('M15 4 7 12l8 8')}</button>` +
    `<button class="lb__n" id="lbN" aria-label="Следующее фото">${ICON('M9 4l8 8-8 8')}</button><div class="lb__c" id="lbC"></div></div>` +
    `<script src="assets/app.js${ver}"></script></body></html>\n`;
}

// Все пути к файлам, на которые ссылается содержимое (для очистки неиспользуемых фото)
export function usedFiles(c) {
  const out = new Set();
  const walk = v => {
    if (typeof v === 'string') { if (/^(img\/|og-image|favicon|apple-touch)/.test(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([key, x]) => key !== 'dims' && walk(x));
  };
  walk(c);
  return out;
}
