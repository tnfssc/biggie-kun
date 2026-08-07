/* Hallmark · genre: playful · macrostructure: Component Playground · theme: Hum
 * enrichment: none (typography + CSS character) · nav: N1a · footer: Ft8
 * audience: API tinkerers · use: copy curl / call model · tone: playful+technical
 * Hallmark · pre-emit critique: P4 H4 E4 S4 R4 V4
 */

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
  <ellipse cx="256" cy="470" rx="140" ry="18" fill="currentColor" opacity="0.08"/>
  <ellipse cx="256" cy="256" rx="210" ry="198" fill="#fffef6" stroke="currentColor" stroke-width="22"/>
  <g class="eyes">
    <ellipse class="eye" cx="196" cy="220" rx="24" ry="30" fill="currentColor"/>
    <ellipse class="eye" cx="316" cy="220" rx="24" ry="30" fill="currentColor"/>
  </g>
  <ellipse cx="154" cy="268" rx="34" ry="22" fill="#f5a8a0"/>
  <ellipse cx="358" cy="268" rx="34" ry="22" fill="#f5a8a0"/>
  <path d="M210 292 C230 324 282 324 302 292" fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round"/>
</svg>`;

export function landingHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>biggie-kun · 1B token context</title>
<meta name="description" content="OpenAI-compatible chat API with a 1 billion token context window. No auth. Call it with curl." />
<meta name="theme-color" content="#f7f4e8" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
:root {
  --color-paper: oklch(97% 0.012 95);
  --color-paper-2: oklch(94% 0.016 95);
  --color-paper-3: oklch(91% 0.020 95);
  --color-ink: oklch(20% 0.012 250);
  --color-ink-2: oklch(20% 0.012 250 / 0.72);
  --color-ink-3: oklch(20% 0.012 250 / 0.55);
  --color-accent: oklch(86% 0.18 95);
  --color-accent-deep: oklch(72% 0.16 95);
  --color-accent-2: oklch(66% 0.18 235);
  --color-accent-3: oklch(68% 0.24 18);
  --color-mint: oklch(80% 0.16 150);
  --color-focus: oklch(66% 0.18 235);
  --color-code: oklch(18% 0.02 250);
  --color-code-ink: oklch(94% 0.02 95);
  --font-display: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-body: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --radius-card: 20px;
  --radius-pill: 999px;
  --radius-input: 12px;
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-snap: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-press: cubic-bezier(0.2, 0.7, 0.3, 1);
  --shell: 72rem;
  --page-gutter: clamp(1rem, 4vw, 2rem);
  --section-gap: clamp(3rem, 8vw, 5.5rem);
  --shadow-card: 0 2px 0 oklch(20% 0.012 250 / 0.04), 0 14px 36px -18px oklch(20% 0.012 250 / 0.18);
}
*, *::before, *::after { box-sizing: border-box; }
html, body { overflow-x: clip; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: 1.0625rem;
  line-height: 1.55;
  font-feature-settings: "ss01" on, "cv11" on;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--color-accent-2); text-decoration-thickness: 1.5px; text-underline-offset: 0.18em; }
a:hover { color: var(--color-ink); }
:focus-visible { outline: 3px solid color-mix(in oklch, var(--color-focus) 70%, white); outline-offset: 3px; }
.mono, .eyebrow {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-ink-3);
  font-weight: 500;
}
.shell {
  max-width: var(--shell);
  margin-inline: auto;
  padding-inline: var(--page-gutter);
}
.section {
  max-width: var(--shell);
  margin-inline: auto;
  padding: var(--section-gap) var(--page-gutter);
}
.section--band {
  max-width: none;
  padding-inline: 0;
  background: var(--color-paper-2);
}
.section--band > .shell { padding-block: var(--section-gap); }
.section--cyan { background: color-mix(in oklch, var(--color-accent-2) 10%, var(--color-paper)); }
.section--pear { background: color-mix(in oklch, var(--color-accent) 18%, var(--color-paper)); }

/* nav N1a */
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 1.1rem;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  color: inherit;
  text-decoration: none;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-size: 1.05rem;
}
.brand-mark {
  width: 2rem;
  height: 2rem;
  color: var(--color-ink);
  display: grid;
  place-items: center;
}
.brand-mark svg { width: 100%; height: 100%; display: block; }
.nav-links {
  display: flex;
  align-items: center;
  gap: 0.35rem 1rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.nav-links a {
  color: var(--color-ink-2);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;
}
.nav-links a:hover { color: var(--color-ink); }

/* buttons */
.btn {
  --btn-face: var(--color-accent);
  --btn-ink: var(--color-ink);
  --btn-edge: var(--color-accent-deep);
  --btn-cast: oklch(76% 0.20 95 / 0.45);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45em;
  padding: 0.75rem 1.25rem;
  font: inherit;
  font-weight: 600;
  border: 0;
  border-radius: var(--radius-pill);
  color: var(--btn-ink);
  background: var(--btn-face);
  cursor: pointer;
  position: relative;
  isolation: isolate;
  box-shadow: 0 4px 0 0 var(--btn-edge), 0 6px 12px -3px var(--btn-cast);
  transform: translateY(0);
  transition: transform 140ms var(--ease-press), box-shadow 140ms var(--ease-press), background-color 160ms;
  text-decoration: none;
  white-space: nowrap;
}
.btn:hover { transform: translateY(-2px); box-shadow: 0 6px 0 0 var(--btn-edge), 0 12px 22px -4px var(--btn-cast); }
.btn:active { transform: translateY(3px); box-shadow: 0 1px 0 0 var(--btn-edge), 0 2px 6px -2px var(--btn-cast); transition-duration: 70ms; }
.btn:focus-visible { outline: 3px solid color-mix(in oklch, var(--btn-edge) 70%, var(--color-focus)); outline-offset: 3px; }
.btn--sm { padding: 0.45rem 0.85rem; font-size: 0.88rem; box-shadow: 0 3px 0 0 var(--btn-edge), 0 4px 10px -3px var(--btn-cast); }
.btn--sm:hover { box-shadow: 0 5px 0 0 var(--btn-edge), 0 10px 18px -4px var(--btn-cast); }
.btn--cyan {
  --btn-face: var(--color-accent-2);
  --btn-ink: white;
  --btn-edge: oklch(52% 0.16 235);
  --btn-cast: oklch(66% 0.18 235 / 0.35);
}
.btn--ink {
  --btn-face: var(--color-ink);
  --btn-ink: var(--color-paper);
  --btn-edge: oklch(12% 0.02 250);
  --btn-cast: oklch(20% 0.012 250 / 0.35);
}
.btn--ghost {
  --btn-face: transparent;
  --btn-ink: var(--color-ink);
  --btn-edge: transparent;
  --btn-cast: transparent;
  box-shadow: none;
  border: 2px solid color-mix(in oklch, var(--color-ink) 14%, transparent);
}
.btn--ghost:hover {
  background: color-mix(in oklch, var(--color-accent) 35%, var(--color-paper));
  transform: translateY(-1px);
  box-shadow: none;
}
.btn--ghost:active { transform: translateY(1px); box-shadow: none; }
.btn.is-copied {
  --btn-face: var(--color-mint);
  --btn-edge: oklch(62% 0.14 150);
  --btn-cast: oklch(80% 0.16 150 / 0.4);
}

/* hero — off-centre */
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: clamp(1.5rem, 4vw, 3rem);
  align-items: end;
  padding-block: clamp(2rem, 6vw, 4rem) clamp(2.5rem, 7vw, 5rem);
}
.hero-kicker { margin: 0 0 0.85rem; }
.hero h1 {
  margin: 0;
  font-family: var(--font-display);
  font-style: normal;
  font-weight: 700;
  font-size: clamp(2.4rem, 6.5vw + 0.4rem, 4.6rem);
  line-height: 0.98;
  letter-spacing: -0.035em;
  overflow-wrap: anywhere;
  min-width: 0;
}
.hero-lead {
  margin: 1.1rem 0 0;
  max-width: 34rem;
  font-size: clamp(1.05rem, 1.2vw + 0.85rem, 1.25rem);
  color: var(--color-ink-2);
  font-weight: 500;
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.6rem;
}
.counter-card {
  background: var(--color-paper);
  border-radius: calc(var(--radius-card) + 4px);
  box-shadow: var(--shadow-card);
  padding: 1.25rem 1.35rem 1.4rem;
  position: relative;
  overflow: hidden;
  border: 2px solid color-mix(in oklch, var(--color-ink) 8%, transparent);
  transform: rotate(1.5deg);
  transition: transform 220ms var(--ease-spring), box-shadow 220ms;
}
.counter-card:hover {
  transform: rotate(0deg) translateY(-4px);
  box-shadow: 0 4px 0 oklch(20% 0.012 250 / 0.05), 0 22px 40px -18px oklch(20% 0.012 250 / 0.22);
}
.counter-card .eyebrow { margin: 0 0 0.35rem; }
.counter {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2.6rem, 5vw + 1rem, 4.2rem);
  letter-spacing: -0.04em;
  line-height: 1;
  background-image: linear-gradient(var(--hl, oklch(86% 0.18 95 / 0.55)) 0 0);
  background-repeat: no-repeat;
  background-size: 100% 0.18em;
  background-position: 0 88%;
  width: fit-content;
}
.counter-unit {
  margin: 0.55rem 0 0;
  font-weight: 600;
  color: var(--color-ink-2);
}
.character {
  --tilt-x: 0deg;
  --tilt-y: 0deg;
  width: min(100%, 11rem);
  margin: 1.1rem auto 0;
  color: var(--color-ink);
  filter: drop-shadow(0 10px 18px oklch(20% 0.012 250 / 0.12));
  transform: perspective(600px) rotateX(var(--tilt-y)) rotateY(var(--tilt-x));
  transition: transform 180ms var(--ease-press);
  cursor: default;
  user-select: none;
}
.character svg { width: 100%; height: auto; display: block; }
.character .eyes { transform-origin: 256px 220px; animation: blink 5.5s var(--ease-snap) infinite; }
@keyframes blink {
  0%, 92%, 100% { transform: scaleY(1); }
  94%, 96% { transform: scaleY(0.08); }
}
.character.is-wiggle { animation: wiggle 420ms var(--ease-spring); }
@keyframes wiggle {
  0% { transform: perspective(600px) rotate(0deg) scale(1); }
  30% { transform: perspective(600px) rotate(-6deg) scale(1.04); }
  60% { transform: perspective(600px) rotate(5deg) scale(1.03); }
  100% { transform: perspective(600px) rotate(0deg) scale(1); }
}

/* playground */
.play-head {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.play-head h2 {
  margin: 0.35rem 0 0;
  font-size: clamp(1.7rem, 3vw + 0.6rem, 2.4rem);
  letter-spacing: -0.03em;
  font-weight: 700;
  font-style: normal;
}
.snippet {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 0.9rem;
  margin-bottom: 1rem;
  align-items: stretch;
}
.snippet-meta {
  background: var(--color-paper);
  border-radius: var(--radius-card);
  padding: 1.15rem 1.2rem 1.25rem;
  box-shadow: var(--shadow-card);
  border: 2px solid color-mix(in oklch, var(--color-ink) 7%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  transition: transform 220ms var(--ease-spring), box-shadow 220ms, border-color 160ms, background-color 160ms;
}
.snippet:nth-child(odd) .snippet-meta { --tint: var(--color-accent); }
.snippet:nth-child(even) .snippet-meta { --tint: var(--color-accent-2); }
.snippet-meta:hover {
  transform: translateY(-3px);
  background: color-mix(in oklch, var(--tint) 10%, var(--color-paper));
  border-color: color-mix(in oklch, var(--tint) 35%, transparent);
  box-shadow: 0 4px 0 oklch(20% 0.012 250 / 0.04), 0 18px 34px -16px oklch(20% 0.012 250 / 0.2);
}
.snippet-meta h3 {
  margin: 0;
  font-size: 1.15rem;
  letter-spacing: -0.02em;
  font-weight: 700;
  font-style: normal;
}
.snippet-meta p {
  margin: 0;
  color: var(--color-ink-2);
  font-size: 0.98rem;
}
.snippet-meta .tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: auto;
  padding-top: 0.5rem;
}
.tag {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.28rem 0.55rem;
  border-radius: var(--radius-pill);
  background: color-mix(in oklch, var(--tint, var(--color-accent)) 22%, var(--color-paper));
  color: var(--color-ink);
  font-weight: 500;
}
.code-block {
  position: relative;
  background: var(--color-code);
  color: var(--color-code-ink);
  border-radius: var(--radius-card);
  padding: 1rem 1rem 1rem;
  min-width: 0;
  box-shadow: 0 16px 40px -20px oklch(20% 0.02 250 / 0.55);
  overflow: hidden;
}
.code-block pre {
  margin: 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.55;
  white-space: pre;
  tab-size: 2;
}
.code-block code { font-family: inherit; }
.code-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.7rem;
}
.code-top .eyebrow { color: oklch(94% 0.02 95 / 0.55); }
.copy-btn {
  --btn-face: oklch(94% 0.02 95 / 0.1);
  --btn-ink: var(--color-code-ink);
  --btn-edge: oklch(94% 0.02 95 / 0.18);
  --btn-cast: transparent;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.4rem 0.7rem;
  box-shadow: 0 2px 0 0 var(--btn-edge);
}
.copy-btn:hover {
  --btn-face: oklch(86% 0.18 95 / 0.9);
  --btn-ink: var(--color-ink);
  --btn-edge: oklch(72% 0.16 95);
  box-shadow: 0 4px 0 0 var(--btn-edge);
}
.copy-btn.is-copied {
  --btn-face: var(--color-mint);
  --btn-ink: var(--color-ink);
  --btn-edge: oklch(62% 0.14 150);
}

/* limits */
.limits-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
.limit {
  background: var(--color-paper);
  border-radius: var(--radius-card);
  padding: 1rem 1.05rem 1.1rem;
  border: 2px solid color-mix(in oklch, var(--color-ink) 7%, transparent);
  min-width: 0;
  transition: transform 200ms var(--ease-spring), background-color 160ms;
}
.limit:nth-child(1) { background: color-mix(in oklch, var(--color-accent) 16%, var(--color-paper)); }
.limit:nth-child(2) { background: color-mix(in oklch, var(--color-accent-2) 12%, var(--color-paper)); }
.limit:nth-child(3) { background: color-mix(in oklch, var(--color-accent-3) 10%, var(--color-paper)); }
.limit:nth-child(4) { background: color-mix(in oklch, var(--color-mint) 14%, var(--color-paper)); }
.limit:hover { transform: translateY(-3px); }
.limit strong {
  display: block;
  font-size: clamp(1.2rem, 2vw + 0.6rem, 1.55rem);
  letter-spacing: -0.03em;
  margin-top: 0.25rem;
  overflow-wrap: anywhere;
}
.limit span.eyebrow { display: block; }

/* notes */
.notes {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 1rem;
}
.note {
  background: var(--color-paper);
  border-radius: var(--radius-card);
  padding: 1.2rem 1.25rem;
  border: 2px dashed color-mix(in oklch, var(--color-ink) 14%, transparent);
}
.note h3 {
  margin: 0 0 0.45rem;
  font-size: 1.1rem;
  letter-spacing: -0.02em;
  font-style: normal;
}
.note p { margin: 0; color: var(--color-ink-2); }
.note ul {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  color: var(--color-ink-2);
}
.note li { margin: 0.25rem 0; }
.base-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.85rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-pill);
  background: color-mix(in oklch, var(--color-accent) 28%, var(--color-paper));
  font-family: var(--font-mono);
  font-size: 0.82rem;
  font-weight: 500;
  letter-spacing: -0.01em;
  max-width: 100%;
  overflow-wrap: anywhere;
}

/* footer marquee Ft8 */
.footer {
  margin-top: 1rem;
  border-top: 2px solid color-mix(in oklch, var(--color-ink) 10%, transparent);
  background: var(--color-ink);
  color: var(--color-paper);
  overflow: hidden;
}
.marquee {
  display: flex;
  gap: 0;
  width: max-content;
  animation: marquee 28s linear infinite;
  padding-block: 0.9rem;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
}
.marquee span { padding-inline: 1.25rem; opacity: 0.9; }
.marquee span::after {
  content: "·";
  margin-left: 2.5rem;
  opacity: 0.45;
}
@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.footer-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  padding: 1rem var(--page-gutter) 1.35rem;
  max-width: var(--shell);
  margin-inline: auto;
  font-size: 0.92rem;
  color: oklch(97% 0.012 95 / 0.72);
}
.footer-meta a { color: var(--color-accent); text-decoration: none; font-weight: 600; }
.footer-meta a:hover { color: white; }

.star-burst {
  position: fixed;
  width: 24px;
  height: 24px;
  margin: -12px 0 0 -12px;
  background:
    linear-gradient(90deg, transparent 47%, var(--color-accent-3) 47% 53%, transparent 53%),
    linear-gradient(0deg, transparent 47%, var(--color-accent-3) 47% 53%, transparent 53%);
  animation: star-burst 420ms ease-out forwards;
  pointer-events: none;
  z-index: 50;
}
@keyframes star-burst {
  0% { transform: scale(0) rotate(0deg); opacity: 1; }
  60% { transform: scale(1.2) rotate(35deg); opacity: 0.9; }
  100% { transform: scale(1.4) rotate(45deg); opacity: 0; }
}

@media (max-width: 860px) {
  .hero { grid-template-columns: 1fr; }
  .counter-card { transform: none; max-width: 22rem; }
  .snippet { grid-template-columns: 1fr; }
  .limits-grid { grid-template-columns: 1fr 1fr; }
  .notes { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .limits-grid { grid-template-columns: 1fr; }
  .nav-links a:not(.btn) { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .character .eyes { animation: none; }
  .character, .counter-card, .snippet-meta, .limit, .btn { transition: none !important; }
  .counter-card:hover, .snippet-meta:hover, .limit:hover, .btn:hover, .btn:active { transform: none; }
  .marquee { animation: none; }
  .star-burst { display: none; }
}
</style>
</head>
<body>
  <header class="shell nav">
    <a class="brand" href="/">
      <span class="brand-mark">${LOGO_SVG}</span>
      biggie-kun
    </a>
    <ul class="nav-links">
      <li><a href="#call">Call it</a></li>
      <li><a href="#limits">Limits</a></li>
      <li><a class="btn btn--sm" href="#call">Try curl</a></li>
    </ul>
  </header>

  <main>
    <section class="shell hero" aria-label="Intro">
      <div>
        <p class="eyebrow hero-kicker">OpenAI-compatible · no auth</p>
        <h1>One billion tokens.<br />It just works differently.</h1>
        <p class="hero-lead">
          Public chat API. Context stays in RAM. Paste a mountain of text,
          ask a small question, get an answer. Base URL is this host.
        </p>
        <div class="hero-actions">
          <a class="btn" href="#call">Copy a request</a>
          <a class="btn btn--ghost" href="/health">Health check</a>
        </div>
      </div>
      <aside class="counter-card" aria-label="Context window">
        <p class="eyebrow">Context window</p>
        <div class="counter" data-count="1000000000">0</div>
        <p class="counter-unit">tokens · reported on every call</p>
        <div class="character" id="kun" title="biggie-kun" aria-hidden="true">${LOGO_SVG}</div>
      </aside>
    </section>

    <section class="section section--band section--pear" id="call">
      <div class="shell">
        <div class="play-head">
          <div>
            <p class="eyebrow">01 · Call the model</p>
            <h2>Try it. Then take the snippet home.</h2>
          </div>
          <p class="base-pill" title="API base">BASE · <span id="base">…</span></p>
        </div>

        <article class="snippet">
          <div class="snippet-meta">
            <p class="eyebrow">Quick chat</p>
            <h3>Plain completion</h3>
            <p>POST <code>/v1/chat/completions</code>. Same shape as OpenAI. Model name is <code>biggie-kun</code>.</p>
            <div class="tags"><span class="tag">POST</span><span class="tag">JSON</span><span class="tag">no key</span></div>
          </div>
          <div class="code-block">
            <div class="code-top">
              <span class="eyebrow">curl</span>
              <button type="button" class="btn btn--sm copy-btn" data-copy="quick">Copy</button>
            </div>
            <pre><code id="snip-quick"></code></pre>
          </div>
        </article>

        <article class="snippet">
          <div class="snippet-meta">
            <p class="eyebrow">Stream + think</p>
            <h3>SSE with reasoning</h3>
            <p>Order: role → <code>reasoning_content</code> → <code>content</code> → stop + usage → <code>[DONE]</code>. Set <code>include_reasoning: false</code> to skip thinking.</p>
            <div class="tags"><span class="tag">stream</span><span class="tag">SSE</span><span class="tag">reasoning</span></div>
          </div>
          <div class="code-block">
            <div class="code-top">
              <span class="eyebrow">curl -N</span>
              <button type="button" class="btn btn--sm copy-btn" data-copy="stream">Copy</button>
            </div>
            <pre><code id="snip-stream"></code></pre>
          </div>
        </article>

        <article class="snippet">
          <div class="snippet-meta">
            <p class="eyebrow">Multi-turn RAM</p>
            <h3>Keep a memory_id</h3>
            <p>Optional. Body field, <code>x-memory-id</code>, or <code>user</code>. RAM only — not auth, not disk. Gone on restart.</p>
            <div class="tags"><span class="tag">memory_id</span><span class="tag">header</span><span class="tag">RAM</span></div>
          </div>
          <div class="code-block">
            <div class="code-top">
              <span class="eyebrow">two turns</span>
              <button type="button" class="btn btn--sm copy-btn" data-copy="memory">Copy</button>
            </div>
            <pre><code id="snip-memory"></code></pre>
          </div>
        </article>

        <article class="snippet">
          <div class="snippet-meta">
            <p class="eyebrow">Python</p>
            <h3>OpenAI SDK</h3>
            <p>Point <code>base_url</code> here. Leave <code>api_key</code> as anything — auth is off.</p>
            <div class="tags"><span class="tag">openai</span><span class="tag">sdk</span></div>
          </div>
          <div class="code-block">
            <div class="code-top">
              <span class="eyebrow">python</span>
              <button type="button" class="btn btn--sm copy-btn" data-copy="py">Copy</button>
            </div>
            <pre><code id="snip-py"></code></pre>
          </div>
        </article>
      </div>
    </section>

    <section class="section" id="limits">
      <p class="eyebrow">02 · Budget</p>
      <h2 style="margin:0.35rem 0 1.1rem;font-size:clamp(1.7rem,3vw + .6rem,2.4rem);letter-spacing:-.03em;font-weight:700;font-style:normal">Friendly limits, still public</h2>
      <div class="limits-grid">
        <div class="limit"><span class="eyebrow">Requests</span><strong>10 / hour / IP</strong></div>
        <div class="limit"><span class="eyebrow">Input tokens</span><strong>1B / hour / IP</strong></div>
        <div class="limit"><span class="eyebrow">Link pace</span><strong>32 Mbit/s</strong></div>
        <div class="limit"><span class="eyebrow">In flight</span><strong>1 global</strong></div>
      </div>
    </section>

    <section class="section section--band section--cyan">
      <div class="shell notes">
        <div class="note">
          <h3>What you get back</h3>
          <ul>
            <li><code>usage.prompt_tokens</code> = size of <em>your</em> input (<code>ceil(utf8_bytes/4)</code>, cap 1B)</li>
            <li><code>completion_tokens</code> = reasoning + answer</li>
            <li><code>completion_tokens_details.reasoning_tokens</code> = thinking only</li>
            <li>Header <code>x-biggie-context-window: 1000000000</code></li>
          </ul>
        </div>
        <div class="note">
          <h3>Endpoints</h3>
          <ul>
            <li><code>GET /</code> — this page</li>
            <li><code>GET /health</code> — liveness</li>
            <li><code>POST /v1/chat/completions</code> — the model</li>
          </ul>
          <p style="margin-top:.75rem">MIT · <a href="https://github.com/tnfssc/biggie-kun">github.com/tnfssc/biggie-kun</a></p>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="marquee" aria-hidden="true">
      <span>1B token context</span><span>works differently</span><span>no auth</span><span>RAM only</span>
      <span>OpenAI-compatible</span><span>biggie-kun</span><span>stream + reason</span><span>32 Mbit/s</span>
      <span>1B token context</span><span>works differently</span><span>no auth</span><span>RAM only</span>
      <span>OpenAI-compatible</span><span>biggie-kun</span><span>stream + reason</span><span>32 Mbit/s</span>
    </div>
    <div class="footer-meta">
      <span>biggie-kun · public demo</span>
      <span><a href="https://github.com/tnfssc/biggie-kun">source</a> · <a href="/health">health</a></span>
    </div>
  </footer>

<script>
(function () {
  const base = location.origin;
  const el = (id) => document.getElementById(id);
  el("base").textContent = base;

  const snippets = {
    quick: \`curl -s \${base}/v1/chat/completions \\\\
  -H 'content-type: application/json' \\\\
  -d '{
    "model": "biggie-kun",
    "messages": [
      {"role":"user","content":"The launch window is 04:30 UTC. When is launch?"}
    ]
  }'\`,
    stream: \`curl -N \${base}/v1/chat/completions \\\\
  -H 'content-type: application/json' \\\\
  -d '{
    "model": "biggie-kun",
    "stream": true,
    "include_reasoning": true,
    "messages": [
      {"role":"user","content":"The launch window is 04:30 UTC. When is launch?"}
    ]
  }'\`,
    memory: \`# turn 1
curl -s \${base}/v1/chat/completions \\\\
  -H 'content-type: application/json' \\\\
  -H 'x-memory-id: demo' \\\\
  -d '{"model":"biggie-kun","messages":[{"role":"user","content":"Code is CODE-ORANGE99."}]}'

# turn 2
curl -s \${base}/v1/chat/completions \\\\
  -H 'content-type: application/json' \\\\
  -H 'x-memory-id: demo' \\\\
  -d '{"model":"biggie-kun","messages":[{"role":"user","content":"What is the code?"}]}'\`,
    py: \`from openai import OpenAI

client = OpenAI(
    base_url="\${base}/v1",
    api_key="not-needed",
)

r = client.chat.completions.create(
    model="biggie-kun",
    messages=[{"role": "user", "content": "Say hi in one word."}],
)
print(r.choices[0].message.content)\`,
  };

  for (const [key, text] of Object.entries(snippets)) {
    const node = el("snip-" + key);
    if (node) node.textContent = text;
  }

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // counter tick-up
  const counter = document.querySelector(".counter");
  const target = Number(counter?.dataset.count || 0);
  const fmt = (n) => n.toLocaleString("en-US");
  if (counter) {
    if (reduce) {
      counter.textContent = fmt(target);
    } else {
      const start = performance.now();
      const dur = 1200;
      const tick = (t) => {
        const p = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        counter.textContent = fmt(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(tick);
        else {
          counter.textContent = fmt(target);
          counter.style.transform = "scale(1.06)";
          setTimeout(() => { counter.style.transform = "scale(1)"; }, 180);
        }
      };
      requestAnimationFrame(tick);
    }
  }

  // character tilt + wiggle
  const kun = el("kun");
  if (kun && !reduce) {
    const card = kun.closest(".counter-card");
    card?.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      kun.style.setProperty("--tilt-x", (x * 14).toFixed(2) + "deg");
      kun.style.setProperty("--tilt-y", (-y * 10).toFixed(2) + "deg");
    });
    card?.addEventListener("pointerleave", () => {
      kun.style.setProperty("--tilt-x", "0deg");
      kun.style.setProperty("--tilt-y", "0deg");
    });
    kun.addEventListener("click", () => {
      kun.classList.remove("is-wiggle");
      void kun.offsetWidth;
      kun.classList.add("is-wiggle");
    });
  }

  function burst(x, y) {
    if (reduce) return;
    const s = document.createElement("span");
    s.className = "star-burst";
    s.style.left = x + "px";
    s.style.top = y + "px";
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 450);
  }

  async function copyText(text, btn, ev) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const label = btn.textContent;
    btn.textContent = "Copied";
    btn.classList.add("is-copied");
    burst(ev.clientX, ev.clientY);
    setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove("is-copied");
    }, 1400);
  }

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      const key = btn.getAttribute("data-copy");
      const text = snippets[key];
      if (text) copyText(text, btn, ev);
    });
  });
})();
</script>
</body>
</html>`;
}

export const FAVICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#f7f4e8"/>
  <ellipse cx="256" cy="270" rx="168" ry="158" fill="#fffef6" stroke="#1a2744" stroke-width="22"/>
  <ellipse cx="206" cy="242" rx="20" ry="26" fill="#1a2744"/>
  <ellipse cx="306" cy="242" rx="20" ry="26" fill="#1a2744"/>
  <ellipse cx="168" cy="282" rx="28" ry="18" fill="#f5a8a0"/>
  <ellipse cx="344" cy="282" rx="28" ry="18" fill="#f5a8a0"/>
  <path d="M218 302 C234 328 278 328 294 302" fill="none" stroke="#1a2744" stroke-width="18" stroke-linecap="round"/>
</svg>
`;
