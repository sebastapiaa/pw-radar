# Design Direction

## Status

**Proposed, not approved.** Seb has not yet supplied PerimeterWatch's brand hex values or
typeface. Everything below marked `TODO-BRAND` is a placeholder to build against. Ask him
before shipping visual polish.

## Apple HIG skill

Seb wants this reviewed against https://github.com/dickwu/apple-design-skill — a
framework-agnostic HIG reviewer, pure markdown, 53 reference documents. Install it in this
session:

```
git clone https://github.com/dickwu/apple-design-skill.git
claude install-skill ./apple-design-skill
```

Relevant references for this build: `layout`, `color`, `typography`, `dark-mode`,
`accessibility`. Run the review **after** the dashboard is built, not before. It is an
audit tool, not a token source.

Two caveats. It has no license file, only a note that the guidelines derive from Apple's
public HIG — fine for an internal tool, do not ship it in a client deliverable. And the
HIG is written for native mobile and desktop; where it conflicts with web convention,
follow the web.

## What this thing actually is

A timing instrument. Not a CRM, not a list. The entire value is *when*, and the interface
should make decay legible: a signal from yesterday and a signal from three weeks ago
should not look the same at a glance.

That is the one idea worth spending boldness on. Everything else stays quiet.

## Signature element

**Recency is carried by color temperature, not by a date string.** A finding's accent
warms as it is fresh and cools as it decays, so the ranked list reads as a heat gradient
before you read a single word. The date is still there, but it is confirmation, not the
primary channel.

Two constraints: it must survive colorblindness (pair temperature with position and an
explicit age label, never temperature alone), and it must not turn into a decorative
gradient wash. The color is data.

## Account profile: highlighted evidence

Seb's own spec (see `docs/CONTEXT.md`): the account profile shows the company
description and signal text in plain prose, with the phrases that constitute intent
signals highlighted, each highlight tied to the PerimeterWatch scope it maps to. The
profile answers "what do they need from us, in their own words."

Treatment rules:

- Highlight = tinted background plus underline, never color alone (colorblind rule).
- Hovering or tapping a highlight names the scope (e.g. "ThreatWatch MDR") and the
  signal behind it (topic, score, date). Highlights are anchors into evidence, not
  decoration.
- Highlight tint can reuse the decay ramp so a fresh signal phrase reads warmer than a
  stale one — same encoding in list and profile, learned once.
- Only genuinely signal-bearing phrases get highlighted. Over-highlighting turns the
  profile into noise and kills trust in the marks.

## Numbering

PerimeterWatch's own site numbers everything: `No. 001`, `001/003` across services and
insights. Carry it over, because a ranked findings list genuinely is a sequence and this
is brand-derived rather than decoration. Use `007/042` form — position and total, so the
weekly volume is visible without a separate stat.

## Tokens

Sampled from the studio's own brand assets (2026-09). These are no longer guesses.

```
--brand-red    #FF4944   PerimeterWatch red: logo field, display type, fresh accent
--canvas       #BABABA   the brand's grey; light-theme page background
--paper        #FEFEFE   off-white panels and footers on the light theme
--ink          #060606   display and body text on light
--dark-bg      #141414   dark-theme base (derived: the brand ships no dark sample;
                         keep it neutral, not blue-tinted, to stay with the grey family)
--dark-text    #E9E9E7
--cool         #6B7684   decay ramp, cold end (desaturated slate; derived)
```

Decay ramp runs **#FF4944 (fresh) → --cool (decayed)**, interpolated in OKLCH. The
brand red never doubles as an error color; errors get a clearly distinct treatment.

The light theme is the brand look: grey #BABABA canvas, white panels, black text, red
reserved for display moments and fresh signals. Dark theme mirrors it with the same red
discipline. Site ships a light/dark toggle; match it, light as the marketing-faithful
mode, dark fine as console default.

PerimeterWatch's site ships a light/dark toggle. Match it. Dark is the default here since
this is a console, but light must work properly, not as an afterthought.

## Type

The brand sets everything in a tight Helvetica-class grotesque (reads as Helvetica
Now / Neue Haas territory) with one signature device: an italic serif for a single
emphasized word inside caps microlabels ("WE'RE *the* EXPERTS", "GO *anywhere* WITH
CONFIDENCE"). Ask the studio or whoever owns the site which fonts are licensed and
whether the webfont can be used internally. Until then, a close free grotesque with a
real tabular figure set (e.g. Archivo) plus any decent serif italic for the accent
device.

This is a numbers surface, so **tabular figures are mandatory** — scores and counts
must not shift width as they update.

Sentence case for interface copy. The one exception to the no-caps rule: the brand's
own numbered microlabels (NO.001-style eyebrows) are all-caps on the site and carry
over as-is; nothing else gets capitalized.

The serif-italic accent is the brand's emphasis voice. Use it sparingly in the console,
one natural home: the scope name inside a highlight tooltip.

## Layout

Desktop-first. Seb is at a machine when he works this; the phone is only for the ping.

```
┌────────────────────────────────────────────────────┐
│  Radar          this week 042    credits 8.8k│
├────────────────────────────────────────────────────┤
│ 001/042  ████ Northgate Health          score 94   │
│          SIEM intent, rising 11 days               │
│          + security director hired Aug 19          │
│          ─────────────────────────────────────     │
│ 002/042  ███  Perris Logistics          score 88   │
│          pen testing intent, 6 days                │
└────────────────────────────────────────────────────┘
```

Left aligned. One column. Resist the urge to build a card grid — identical rounded cards
with the same shadow under each is the generic default and it flattens the ranking, which
is the one thing this list is for.

Card expands in place to reveal contacts and the research panel. Do not navigate away.

## Motion

One place only: the moment a finding expands, showing what changed. No entrance
animations on the list, no hover transitions on every row. Respect `prefers-reduced-motion`.

## Copy

- Empty state is the common state. Most weekdays have nothing. Write it as a fact, not an
  apology: "No new signals since Friday." Not "Nothing to see here!"
- Never invent a reason. If the signal is thin, the card says so.
- Active voice on actions. "Export 42 findings", not "Submit".

## Quality floor

Visible keyboard focus, reduced motion respected, contrast checked against the decay ramp
at both ends, responsive down to a phone even though it is desktop-first.
