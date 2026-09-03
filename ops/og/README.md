# Share cards (og:image)

`newsShell()` in `server.js` sets `og:image` via `ogFor(slug, fallback)`, which looks for
`public/og-<slug>.png` and falls back to `bina-news.png` when it is missing. **The filename is the
contract** — it must match the post slug exactly, or the post silently gets the generic card.

The meta declares `og:image:width 1200` and `og:image:height 630`, so that is the size to produce.

## Making one

```bash
ops/og/render-card.sh /root/my-card.html nyc-schools-ai-ban
```

The template should be `1200px x 630px` in CSS (`html,body{width:1200px;height:630px}`). The script
renders it at **device scale 1** and quantises the result.

## The trap this script exists to prevent

The templates were always 1200x630, but they were rendered at 2x device scale, so every card landed at
2400x1260 — four times the pixels, and a declared size that did not match the file. Twenty-five cards
came to 7.3 MB. Re-rendered and quantised they are 1.1 MB, with no visible difference: no platform
renders an og:image wider than 1200.

Two smaller traps, both hit while writing this:

- Chromium (snap) **cannot write into a hidden directory** — a dotdir makes the render fail with no
  error at all. The script works in `$HOME/og-render`.
- `--force-device-scale-factor=1` is the whole point. Leave it out and you get 2x again.

Originals from the bulk re-render are in `/root/storage/og-backup-1788466329`.

## After replacing a card

Facebook, Telegram and LinkedIn cache og:image for weeks. Existing shares keep the old picture until
their cache expires; new shares get the new one. Facebook's Sharing Debugger can force a refresh.

## A starting point

 is the light house style used by the recent Amharic cards: brand, category
pill, date, rule, headline with one phrase in red, lede, three chips and the emoji artwork. Copy it,
change the words, keep  at 1200x630.

Only put facts from the post on a card. A share image travels on its own, so a number invented to
fill a tile has no article around it to correct it.
