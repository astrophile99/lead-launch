import { hostOf, pick, seededRandom } from "@/lib/utils";
import { mockSiteQualityFor, type MockSiteQuality } from "@/providers/business-data/mock";
import { extractSignals } from "./fetch-heuristic";
import type { AuditProvider, AuditProviderResult } from "./types";

/**
 * Mock auditor for demo data.
 *
 * Rather than inventing scores, this provider synthesises a *document* that is
 * representative of the archetype (an abandoned one-pager, a 2014 WordPress
 * build, a competent modern site) and then runs it through exactly the same
 * extractor the real auditor uses. The scoring path is therefore identical to
 * production - only the source of the HTML differs, and it is labelled as mock
 * everywhere it surfaces.
 */

type Archetype = Exclude<MockSiteQuality, "none">;

function poorHtml(name: string, rand: () => number): string {
  return `<!DOCTYPE html>
<html>
<head>
<title>${name}</title>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<script src="https://code.jquery.com/jquery-1.11.3.min.js"></script>
<style>${"body{font-family:Arial}".repeat(40)}</style>
</head>
<body bgcolor="#ffffff">
<table width="900" align="center"><tr><td>
<img src="/images/banner.jpg">
<font size="5">Welcome to ${name}</font>
<p>We are a trusted name serving customers since ${1998 + Math.floor(rand() * 15)}. Quality service, affordable prices.</p>
<p>For more information please contact us.</p>
<img src="/images/photo1.jpg"><img src="/images/photo2.jpg">
<a href="contact.html"><img src="/images/more.gif"></a>
<p>Phone: 022 ${2000 + Math.floor(rand() * 8000)} ${1000 + Math.floor(rand() * 9000)}</p>
</td></tr></table>
</body>
</html>`;
}

function datedHtml(name: string, rand: () => number): string {
  const year = 2013 + Math.floor(rand() * 5);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${name} | Home</title>
<meta name="generator" content="WordPress 4.9.8">
<link rel="stylesheet" href="/wp-content/themes/legacy/bootstrap.min.css">
<link rel="stylesheet" href="/wp-content/themes/legacy/style.css">
<script src="/wp-includes/js/jquery/jquery.js"></script>
<script src="/wp-content/plugins/slider/revolution.js"></script>
<script src="/wp-content/plugins/contact-form-7/scripts.js"></script>
</head>
<body class="home wordpress">
<header>
  <img src="/wp-content/uploads/${year}/logo.png">
  <nav><ul>
    <li><a href="/">Home</a></li>
    <li><a href="/about">About Us</a></li>
    <li><a href="/services">Services</a></li>
    <li><a href="/gallery">Gallery</a></li>
    <li><a href="/contact">Contact Us</a></li>
  </ul></nav>
</header>
<div class="slider"><img src="/wp-content/uploads/${year}/slide1.jpg"><img src="/wp-content/uploads/${year}/slide2.jpg"></div>
<h1>Welcome</h1>
<h3>Our Services</h3>
<p>${"We provide the best in class service to all our valued customers with utmost care and dedication. ".repeat(6)}</p>
<h3>Why Choose Us</h3>
<p>${"Experienced staff, modern equipment and a commitment to excellence. ".repeat(5)}</p>
<form action="/wp-admin/admin-post.php" method="post">
  <input type="text" name="name" placeholder="Your Name">
  <input type="text" name="email" placeholder="Your Email">
  <textarea name="message" placeholder="Message"></textarea>
  <input type="submit" value="Send">
</form>
<footer><p>Copyright ${year} ${name}. All rights reserved.</p></footer>
</body>
</html>`;
}

function decentHtml(name: string, rand: () => number): string {
  const cta = pick(rand, ["Book an appointment", "Request a callback", "Enquire now"]);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — Trusted local care</title>
<meta name="description" content="${name} offers professional service with experienced staff. Book an appointment online or call us today.">
<link rel="icon" href="/favicon.ico">
<link rel="canonical" href="https://www.example.com/">
<link rel="stylesheet" href="/assets/site.css">
<script defer src="/assets/site.js"></script>
</head>
<body>
<header>
  <nav aria-label="Main"><a href="/">Home</a><a href="/services">Services</a><a href="/about">About</a><a href="/contact">Contact</a></nav>
  <a class="cta" href="/contact">${cta}</a>
</header>
<main>
<h1>${name}</h1>
<p>${"Careful, unhurried service from a team that has looked after this neighbourhood for years. ".repeat(4)}</p>
<h2>What we do</h2>
<img src="/img/clinic.jpg" alt="Our reception area" width="1200" height="800">
<img src="/img/team.jpg" alt="Our team" width="1200" height="800">
<h2>Get in touch</h2>
<p><a href="tel:+912200000000">Call us</a> or <a href="mailto:hello@example.com">email the team</a>.</p>
<form>
  <label for="nm">Name</label><input id="nm" type="text">
  <label for="em">Email</label><input id="em" type="email">
  <button type="submit">Send enquiry</button>
</form>
</main>
<footer><p>&copy; ${new Date().getFullYear()} ${name}</p>
<a href="https://instagram.com/example">Instagram</a></footer>
</body>
</html>`;
}

function goodHtml(name: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — Book an appointment online</title>
<meta name="description" content="${name}: same-week appointments, transparent pricing and a team that explains everything before it starts. Book online in under a minute.">
<link rel="canonical" href="https://www.example.com/">
<link rel="icon" href="/favicon.svg">
<meta property="og:title" content="${name}">
<meta property="og:description" content="Book an appointment online.">
<meta property="og:image" content="/og.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"${name}","telephone":"+912200000000","openingHours":"Mo-Sa 09:30-19:00"}</script>
<link rel="stylesheet" href="/_next/static/site.css">
<script type="module" src="/_next/static/app.js"></script>
</head>
<body>
<a href="#main">Skip to content</a>
<header>
  <nav aria-label="Main"><a href="/">Home</a><a href="/services">Services</a><a href="/team">Team</a><a href="/contact">Contact</a></nav>
  <a href="/book">Book appointment</a>
  <a href="tel:+912200000000">Call</a>
</header>
<main id="main">
<h1>${name}</h1>
<p>${"Straightforward care with prices published up front and appointments you can book without a phone call. ".repeat(5)}</p>
<h2>Services</h2>
<h3>Consultation</h3>
<h3>Treatment</h3>
<img src="/img/hero.webp" alt="The treatment room" width="1600" height="900">
<img src="/img/team.webp" alt="Our clinicians" width="1600" height="900">
<h2>Visit us</h2>
<p><a href="https://maps.google.com/?q=clinic">Directions</a> · <a href="https://wa.me/912200000000">WhatsApp</a></p>
<form>
  <label for="n">Name</label><input id="n" type="text">
  <label for="p">Phone</label><input id="p" type="tel">
  <button type="submit">Request a slot</button>
</form>
</main>
<footer><nav aria-label="Footer"><a href="/privacy">Privacy</a></nav>
<a href="https://instagram.com/example">Instagram</a><a href="https://facebook.com/example">Facebook</a></footer>
</body>
</html>`;
}

const PROFILE: Record<
  Archetype,
  { loadMs: [number, number]; html: (name: string, rand: () => number) => string }
> = {
  poor: { loadMs: [3200, 9000], html: poorHtml },
  dated: { loadMs: [2400, 6200], html: datedHtml },
  decent: { loadMs: [900, 2200], html: decentHtml },
  good: { loadMs: [380, 1100], html: (name) => goodHtml(name) },
};

export class MockAuditProvider implements AuditProvider {
  readonly id = "mock";
  readonly label = "Mock auditor (demo data)";
  readonly isMock = true;

  isConfigured(): boolean {
    return true;
  }

  async inspect(url: string, opts?: { seed?: string }): Promise<AuditProviderResult> {
    const seed = opts?.seed ?? url;
    const quality = mockSiteQualityFor(seed);
    const archetype: Archetype = quality === "none" ? "poor" : quality;
    const rand = seededRandom(`audit:${seed}`);
    const host = hostOf(url) ?? "example.example";
    const name = host
      .replace(/\.example$/, "")
      .replace(/^www\./, "")
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    const profile = PROFILE[archetype];
    const html = profile.html(name, rand);
    const [lo, hi] = profile.loadMs;
    const loadMs = Math.round(lo + rand() * (hi - lo));

    return {
      engine: this.id,
      isMock: true,
      signals: extractSignals(html, {
        url,
        finalUrl: url,
        httpStatus: 200,
        loadMs,
        bytes: Buffer.byteLength(html, "utf8") * (archetype === "poor" ? 6 : 3),
        contentType: "text/html; charset=utf-8",
        serverHeader: archetype === "good" ? "Vercel" : "Apache",
      }),
    };
  }
}
