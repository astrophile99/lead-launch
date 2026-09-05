import { resolveIndustry } from "@/config/industries";
import type { BusinessRecord, WebsiteBrief } from "@/types";

/**
 * The built-in site generator.
 *
 * This is a deterministic generator, not an AI agent, and the UI says so. It
 * exists because a demo build must produce a *real, runnable, deployable* site
 * rather than a placeholder screenshot - and because a rules-based baseline
 * gives the AI build path something concrete to be measured against.
 *
 * Design rules it follows (see the quality philosophy in the product spec):
 *  - one confident accent, used only for actions
 *  - a real type scale, not three sizes of grey
 *  - asymmetric section rhythm; no wall of equal three-column cards
 *  - every claim traceable to stored data; unknowns rendered as visible
 *    [CLIENT TO CONFIRM] markers rather than invented copy
 *  - mobile-first, tap-to-call in the header, action repeated per section
 */

export type GeneratedFile = { path: string; content: string };

export type GeneratorInput = {
  business: BusinessRecord;
  brief: WebsiteBrief;
  /** Rendered into the footer so a generated site is never mistaken for live. */
  watermark: boolean;
};

type Palette = {
  ink: string;
  inkSoft: string;
  paper: string;
  paperAlt: string;
  line: string;
  accent: string;
  accentInk: string;
};

const PALETTES: Record<string, Palette> = {
  dental: {
    ink: "#101c22", inkSoft: "#4a5c63", paper: "#fbfaf7", paperAlt: "#f1f0ea",
    line: "#e0ded4", accent: "#0f5c68", accentInk: "#ffffff",
  },
  medical: {
    ink: "#0f1a24", inkSoft: "#4b5b68", paper: "#fbfbf9", paperAlt: "#eef1f0",
    line: "#dfe3e2", accent: "#1a5a7a", accentInk: "#ffffff",
  },
  restaurant: {
    ink: "#1c1613", inkSoft: "#5f544d", paper: "#fdfaf5", paperAlt: "#f4ece1",
    line: "#e6dbcb", accent: "#a8412a", accentInk: "#ffffff",
  },
  salon: {
    ink: "#1d1719", inkSoft: "#61545a", paper: "#fdfaf9", paperAlt: "#f5eeec",
    line: "#e8dcd9", accent: "#7c3b52", accentInk: "#ffffff",
  },
  gym: {
    ink: "#121417", inkSoft: "#535a61", paper: "#fafafa", paperAlt: "#eeefef",
    line: "#e0e2e2", accent: "#1f6b45", accentInk: "#ffffff",
  },
  "real-estate": {
    ink: "#141719", inkSoft: "#565c60", paper: "#fbfbfa", paperAlt: "#eff0ee",
    line: "#e1e3e0", accent: "#34503c", accentInk: "#ffffff",
  },
  law: {
    ink: "#14161c", inkSoft: "#535764", paper: "#fbfbfc", paperAlt: "#eeeff2",
    line: "#e0e2e7", accent: "#2c3e6b", accentInk: "#ffffff",
  },
  accounting: {
    ink: "#14171a", inkSoft: "#545a60", paper: "#fbfbfb", paperAlt: "#eef0f1",
    line: "#e1e3e4", accent: "#1f4f52", accentInk: "#ffffff",
  },
  interior: {
    ink: "#1a1714", inkSoft: "#5c554d", paper: "#fcfaf7", paperAlt: "#f2ede5",
    line: "#e5ddd1", accent: "#8a6a3f", accentInk: "#ffffff",
  },
  construction: {
    ink: "#16181a", inkSoft: "#565b5f", paper: "#fafaf9", paperAlt: "#eeefee",
    line: "#e0e2e1", accent: "#9a5a1e", accentInk: "#ffffff",
  },
  education: {
    ink: "#131820", inkSoft: "#505966", paper: "#fbfbfa", paperAlt: "#eef0f3",
    line: "#e1e3e7", accent: "#243f7a", accentInk: "#ffffff",
  },
  automotive: {
    ink: "#121416", inkSoft: "#52585c", paper: "#fafafa", paperAlt: "#ededee",
    line: "#dfe0e1", accent: "#1e4f8a", accentInk: "#ffffff",
  },
  hospitality: {
    ink: "#1a1815", inkSoft: "#5d564e", paper: "#fdfbf7", paperAlt: "#f3eee5",
    line: "#e6dfd2", accent: "#6b5230", accentInk: "#ffffff",
  },
  retail: {
    ink: "#171718", inkSoft: "#575758", paper: "#fbfbfa", paperAlt: "#efefee",
    line: "#e2e2e1", accent: "#3d4a78", accentInk: "#ffffff",
  },
  general: {
    ink: "#15171a", inkSoft: "#555b61", paper: "#fbfbfa", paperAlt: "#eff0f0",
    line: "#e1e3e3", accent: "#2f5d50", accentInk: "#ffffff",
  },
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Serialises JSON for embedding inside a <script> element.
 *
 * HTML escaping is wrong here - the content is JSON, not markup - so the angle
 * brackets and ampersands are emitted as JSON unicode escapes instead. Without
 * this, a business whose name contains "</script>" would close the element and
 * inject markup into the generated page.
 */
const jsonForScript = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const TODO = (what: string) =>
  `<span class="todo" title="Supplied by the client before launch">[${esc(what)}]</span>`;

function telHref(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 8 ? `tel:${digits}` : null;
}

function css(p: Palette): string {
  return `:root{
  --ink:${p.ink};--ink-soft:${p.inkSoft};--paper:${p.paper};--paper-alt:${p.paperAlt};
  --line:${p.line};--accent:${p.accent};--accent-ink:${p.accentInk};
  --measure:34rem;--gutter:clamp(1.25rem,4vw,3.5rem);
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);
  font:400 clamp(1rem,0.97rem + 0.15vw,1.0625rem)/1.65 ui-serif,Georgia,"Times New Roman",serif;
  font-synthesis-weight:none;text-rendering:optimizeLegibility}
h1,h2,h3,.ui{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
h1,h2,h3{margin:0;line-height:1.08;letter-spacing:-0.022em;font-weight:620}
h1{font-size:clamp(2.3rem,1.6rem + 3.2vw,4.1rem)}
h2{font-size:clamp(1.55rem,1.2rem + 1.5vw,2.35rem)}
h3{font-size:clamp(1.1rem,1rem + 0.4vw,1.3rem);letter-spacing:-0.012em}
p{margin:0 0 1.1em;max-width:var(--measure)}
a{color:inherit}
img{max-width:100%;height:auto;display:block}
.wrap{max-width:72rem;margin-inline:auto;padding-inline:var(--gutter)}
.eyebrow{font:600 0.72rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;
  text-transform:uppercase;color:var(--accent);margin:0 0 1rem}
.lede{font-size:clamp(1.1rem,1.02rem + 0.4vw,1.3rem);color:var(--ink-soft);max-width:38rem}
.todo{background:#fff3c4;color:#5c4700;border-bottom:1px dashed #b08900;
  padding:0 .25em;font-style:normal;font-size:.92em}

/* header */
.site-head{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--paper) 88%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.site-head .wrap{display:flex;align-items:center;gap:1.5rem;min-height:4rem}
.brand{font:650 1.02rem/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.015em;
  text-decoration:none;margin-right:auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
/* Below the nav breakpoint the sticky bar already carries both actions, so the
   header keeps only the name and does not wrap into three cramped lines. */
.site-head .btn{display:none}
.nav{display:none;gap:1.6rem}
.nav a{font:500 0.9rem/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;color:var(--ink-soft)}
.nav a:hover,.nav a:focus-visible{color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  font:600 0.9rem/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;
  padding:.72rem 1.15rem;border-radius:2px;border:1px solid transparent;white-space:nowrap;
  transition:background-color .18s ease,color .18s ease,border-color .18s ease}
.btn-primary{background:var(--accent);color:var(--accent-ink)}
.btn-primary:hover{background:color-mix(in srgb,var(--accent) 86%,#000)}
.btn-ghost{border-color:var(--line);color:var(--ink)}
.btn-ghost:hover{border-color:var(--ink)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

/* hero */
.hero{padding:clamp(3rem,7vw,6.5rem) 0 clamp(2.5rem,5vw,4.5rem);border-bottom:1px solid var(--line)}
.hero-grid{display:grid;gap:clamp(2rem,5vw,4rem)}
.hero-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.9rem}
.facts{display:flex;flex-wrap:wrap;gap:0;margin:2.4rem 0 0;padding:0;list-style:none;
  border-top:1px solid var(--line)}
.facts > div{padding:1rem 1.6rem 1rem 0;margin-right:1.6rem;border-right:1px solid var(--line)}
.facts > div:last-child{border-right:0}
.facts dt{font:600 .7rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;
  text-transform:uppercase;color:var(--ink-soft);margin-bottom:.4rem}
.facts dd{margin:0;font:600 1.28rem/1.1 ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.02em}

/* sections */
section{padding:clamp(3rem,6vw,5.5rem) 0}
section + section{border-top:1px solid var(--line)}
.alt{background:var(--paper-alt)}
.section-head{max-width:40rem;margin-bottom:clamp(2rem,4vw,3rem)}

.services{display:grid;gap:0;border-top:1px solid var(--line)}
.service{padding:1.6rem 0;border-bottom:1px solid var(--line);display:grid;gap:.5rem}
.service h3{margin:0}
.service p{margin:0;color:var(--ink-soft)}
.service .idx{font:600 .72rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;color:var(--accent)}

.proof{display:grid;gap:1.5rem}
.quote{margin:0;padding:1.5rem 0 0;border-top:2px solid var(--ink)}
.quote p{font-size:1.12rem}
.quote figcaption{font:500 .82rem/1.4 ui-sans-serif,system-ui,sans-serif;color:var(--ink-soft)}

.visit{display:grid;gap:2.5rem}
.detail-list{margin:0;padding:0}
.detail-list div{display:grid;grid-template-columns:7.5rem 1fr;gap:1rem;padding:.7rem 0;
  border-bottom:1px solid var(--line)}
.detail-list dt{font:600 .78rem/1.5 ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;
  text-transform:uppercase;color:var(--ink-soft)}
.detail-list dd{margin:0}
.hours{margin:0;padding:0;font-size:.95rem}
.hours div{display:flex;justify-content:space-between;gap:1rem;padding:.35rem 0;
  border-bottom:1px dotted var(--line)}
.hours dt{color:var(--ink-soft)}
.hours dd{margin:0;font-variant-numeric:tabular-nums}

.cta-band{background:var(--ink);color:var(--paper)}
.cta-band h2{color:var(--paper)}
.cta-band p{color:color-mix(in srgb,var(--paper) 72%,transparent)}
.cta-band .btn-primary{background:var(--paper);color:var(--ink)}
.cta-band .btn-ghost{border-color:color-mix(in srgb,var(--paper) 32%,transparent);color:var(--paper)}

form{display:grid;gap:1rem;max-width:30rem}
label{font:600 .78rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;
  text-transform:uppercase;color:var(--ink-soft);display:block;margin-bottom:.45rem}
input,textarea,select{width:100%;font:inherit;font-size:1rem;padding:.7rem .8rem;
  border:1px solid var(--line);border-radius:2px;background:var(--paper);color:var(--ink)}
input:focus,textarea:focus{border-color:var(--accent);outline:none;
  box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
.form-note{font-size:.85rem;color:var(--ink-soft)}

.site-foot{border-top:1px solid var(--line);padding:2.5rem 0 3.5rem;font-size:.9rem;
  color:var(--ink-soft)}
.site-foot nav{display:flex;flex-wrap:wrap;gap:1.2rem;margin-bottom:1rem}
.site-foot a{text-decoration:none}
.site-foot a:hover{text-decoration:underline}
.built-note{margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--line);font-size:.8rem}

/* sticky mobile action */
.mobile-bar{position:fixed;inset:auto 0 0 0;z-index:30;display:flex;gap:.5rem;
  padding:.6rem .8rem calc(.6rem + env(safe-area-inset-bottom));
  background:color-mix(in srgb,var(--paper) 94%,transparent);border-top:1px solid var(--line);
  backdrop-filter:blur(10px)}
.mobile-bar .btn{flex:1}
body{padding-bottom:4.5rem}

@media (min-width:48rem){
  .nav{display:flex}
  .site-head .btn{display:inline-flex}
  .hero-grid{grid-template-columns:1.35fr .65fr;align-items:end}
  .services{grid-template-columns:repeat(2,1fr);column-gap:3rem}
  .proof{grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:2.5rem}
  .visit{grid-template-columns:1.1fr .9fr}
  .mobile-bar{display:none}
  body{padding-bottom:0}
}
@media (prefers-reduced-motion:no-preference){
  .js .reveal{opacity:0;transform:translateY(12px);transition:opacity .6s ease,transform .6s ease}
  .js .reveal.in{opacity:1;transform:none}
}
@media print{.site-head,.mobile-bar{display:none}}
`;
}

const REVEAL_JS = `(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('js');
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach(function(e){e.classList.add('in')}); return; }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -10% 0px' });
  els.forEach(function(e){ io.observe(e); });
})();`;

export function generateSite(input: GeneratorInput): GeneratedFile[] {
  const { business, brief } = input;
  const industry = resolveIndustry(business.category);
  const palette = PALETTES[industry.id] ?? PALETTES.general;

  const name = business.name;
  const area = business.area ?? business.city;
  const tel = telHref(business.phone);
  const services = (business.services ?? []).length
    ? business.services!
    : industry.typicalServices;
  const goal = brief.primaryGoal || industry.primaryConversion;

  const title = `${name} — ${industry.label} in ${area}`.slice(0, 64);
  const description =
    `${name} is a ${industry.label.toLowerCase()} in ${area}, ${business.city}. ` +
    `${goal.replace(/^./, (c) => c.toLowerCase())} online, or call the team directly.`;

  const hasRating = business.rating != null && business.reviewCount != null;

  // The H1 names the business; the strategy sentence from the brief belongs in
  // the supporting line, and only if it reads as prose rather than as notes.
  const positioningTail = brief.positioning.includes(":")
    ? brief.positioning.slice(brief.positioning.indexOf(":") + 1).trim()
    : brief.positioning.trim();
  const heroLede =
    business.description?.trim() ||
    (positioningTail
      ? `${positioningTail.charAt(0).toUpperCase()}${positioningTail.slice(1)}`
      : `${industry.label} serving ${area} and the surrounding neighbourhoods.`);

  const contactAction = tel
    ? `<a class="btn btn-primary" href="${tel}">Call ${esc(business.phone!)}</a>`
    : `<a class="btn btn-primary" href="#contact">${esc(goal)}</a>`;

  const schema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
    ...(business.description ? { description: business.description } : {}),
    ...(business.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: business.address,
            addressLocality: business.city,
            addressCountry: business.country,
          },
        }
      : {}),
    ...(business.phone ? { telephone: business.phone } : {}),
    ...(business.lat && business.lng
      ? { geo: { "@type": "GeoCoordinates", latitude: business.lat, longitude: business.lng } }
      : {}),
    ...(hasRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: business.rating,
            reviewCount: business.reviewCount,
          },
        }
      : {}),
    ...(business.hours
      ? { openingHours: Object.entries(business.hours).map(([d, h]) => `${d.slice(0, 2)} ${h}`) }
      : {}),
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description.slice(0, 158))}">
<link rel="canonical" href="/">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description.slice(0, 158))}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="favicon.svg">
<link rel="stylesheet" href="styles.css">
<script type="application/ld+json">${jsonForScript(schema)}</script>
</head>
<body>
<a class="btn btn-ghost skip" href="#main" style="position:absolute;left:-9999px">Skip to content</a>

<header class="site-head">
  <div class="wrap">
    <a class="brand" href="#main">${esc(name)}</a>
    <nav class="nav" aria-label="Main">
      <a href="#services">Services</a>
      <a href="#proof">Reviews</a>
      <a href="#visit">Visit</a>
      <a href="#contact">Contact</a>
    </nav>
    ${
      tel
        ? `<a class="btn btn-ghost" href="${tel}">Call</a>`
        : ""
    }
    <a class="btn btn-primary" href="#contact">${esc(goal)}</a>
  </div>
</header>

<main id="main">

<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">${esc(industry.label)} · ${esc(area)}</p>
      <h1>${esc(name)}</h1>
      <p class="lede">${esc(heroLede)}</p>
      <div class="hero-actions">
        ${contactAction}
        <a class="btn btn-ghost" href="#services">See what we do</a>
      </div>
    </div>
    <div>
      <dl class="facts">
        ${
          hasRating
            ? `<div><dt>Rating</dt><dd>${business.rating} ★</dd></div>
        <div><dt>Reviews</dt><dd>${business.reviewCount}</dd></div>`
            : `<div><dt>Reviews</dt><dd>${TODO("client to supply")}</dd></div>`
        }
        <div><dt>Area</dt><dd>${esc(area)}</dd></div>
      </dl>
    </div>
  </div>
</section>

<section id="services" class="reveal">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">What we do</p>
      <h2>${esc(services.length ? "Services" : "Our work")}</h2>
      <p class="lede">${
        services.length
          ? "Each of these is a real appointment type. Prices and durations are confirmed before anything starts."
          : TODO("service list to be confirmed with the client")
      }</p>
    </div>
    <div class="services">
      ${services
        .map(
          (s, i) => `<article class="service">
        <span class="idx">${String(i + 1).padStart(2, "0")}</span>
        <h3>${esc(s)}</h3>
        <p>${TODO(`description of ${s.toLowerCase()}`)}</p>
      </article>`,
        )
        .join("\n      ")}
    </div>
  </div>
</section>

<section id="proof" class="alt reveal">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Reputation</p>
      <h2>${
        hasRating
          ? `${business.rating} stars across ${business.reviewCount} reviews`
          : "What people say"
      }</h2>
      <p class="lede">${esc(brief.socialProof || "Reviews are quoted verbatim, with attribution.")}</p>
    </div>
    <div class="proof">
      ${[1, 2, 3]
        .map(
          (n) => `<figure class="quote">
        <p>${TODO(`review ${n} — paste a real review, verbatim`)}</p>
        <figcaption>${TODO("reviewer name and date")}</figcaption>
      </figure>`,
        )
        .join("\n      ")}
    </div>
  </div>
</section>

<section id="visit" class="reveal">
  <div class="wrap visit">
    <div>
      <p class="eyebrow">Find us</p>
      <h2>Visiting</h2>
      <dl class="detail-list">
        <div><dt>Address</dt><dd>${business.address ? esc(business.address) : TODO("full address")}</dd></div>
        ${business.phone ? `<div><dt>Phone</dt><dd><a href="${tel}">${esc(business.phone)}</a></dd></div>` : ""}
        ${business.email ? `<div><dt>Email</dt><dd><a href="mailto:${esc(business.email)}">${esc(business.email)}</a></dd></div>` : ""}
        ${
          business.googleUrl
            ? `<div><dt>Directions</dt><dd><a href="${esc(business.googleUrl)}" rel="noopener">Open in Google Maps</a></dd></div>`
            : ""
        }
      </dl>
    </div>
    <div>
      <h3 style="margin-bottom:1rem">Opening hours</h3>
      <dl class="hours">
        ${
          business.hours
            ? Object.entries(business.hours)
                .map(([day, h]) => `<div><dt>${esc(day)}</dt><dd>${esc(h)}</dd></div>`)
                .join("\n        ")
            : `<div><dt>Hours</dt><dd>${TODO("opening hours")}</dd></div>`
        }
      </dl>
    </div>
  </div>
</section>

<section id="contact" class="cta-band reveal">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow" style="color:inherit;opacity:.7">Next step</p>
      <h2>${esc(goal)}</h2>
      <p class="lede" style="color:inherit;opacity:.8">${esc(
        brief.ctaStrategy ||
          "Leave a number and a preferred time; you will get a call back the same working day.",
      )}</p>
    </div>
    <form method="post" action="#" novalidate>
      <div>
        <label for="f-name">Your name</label>
        <input id="f-name" name="name" type="text" autocomplete="name" required>
      </div>
      <div>
        <label for="f-phone">Phone</label>
        <input id="f-phone" name="phone" type="tel" autocomplete="tel" required>
      </div>
      <div>
        <label for="f-msg">What do you need?</label>
        <textarea id="f-msg" name="message" rows="3"></textarea>
      </div>
      <button class="btn btn-primary" type="submit">Send request</button>
      <p class="form-note">${TODO("connect this form to the client's inbox or booking system")}</p>
    </form>
  </div>
</section>

</main>

<footer class="site-foot">
  <div class="wrap">
    <nav aria-label="Footer">
      <a href="#services">Services</a>
      <a href="#visit">Visit</a>
      <a href="#contact">Contact</a>
      ${business.instagram ? `<a href="${esc(business.instagram)}" rel="noopener">Instagram</a>` : ""}
      ${business.facebook ? `<a href="${esc(business.facebook)}" rel="noopener">Facebook</a>` : ""}
    </nav>
    <p>&copy; ${new Date().getFullYear()} ${esc(name)}${business.address ? `, ${esc(business.city)}` : ""}.</p>
    ${
      input.watermark
        ? `<p class="built-note">Proposal build generated by Lead &rarr; Launch for ${esc(name)}. Highlighted items marked in yellow require confirmation from the business before this goes live — nothing has been invented to fill them.</p>`
        : ""
    }
  </div>
</footer>

${
  tel
    ? `<div class="mobile-bar">
  <a class="btn btn-ghost" href="${tel}">Call</a>
  <a class="btn btn-primary" href="#contact">${esc(goal)}</a>
</div>`
    : `<div class="mobile-bar"><a class="btn btn-primary" href="#contact">${esc(goal)}</a></div>`
}

<script>${REVEAL_JS}</script>
</body>
</html>
`;

  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${palette.accent}"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="32" font-weight="700" fill="${palette.accentInk}" text-anchor="middle">${esc(
    name.trim().charAt(0).toUpperCase(),
  )}</text></svg>`;

  return [
    { path: "index.html", content: html },
    { path: "styles.css", content: css(palette) },
    { path: "favicon.svg", content: favicon },
    { path: "robots.txt", content: "User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n" },
    {
      path: "sitemap.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`,
    },
  ];
}
