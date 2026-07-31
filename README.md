# Pigment — a color instrument

A palette generator that does the colour maths in **OKLCH**, not HSL. Live at
[sedricedwards.github.io/pigment](https://sedricedwards.github.io/pigment/).

## What it does

- **Generate** — 220 candidate palettes per press, scored on lightness spread, perceptual
  distance (ΔE in OKLab), contrast range and the presence of both a quiet and a vivid colour.
  The best one wins.
- **Lock** — click the padlock (or press `1`–`5`). Locked swatches anchor the hue and constrain
  the lightness ramp; everything else regenerates around them.
- **Harmony** — analogous, monochrome, complementary, split-complement, triadic, tetradic, or
  auto (rolls a rule each time). Hue offsets are applied in OKLCH so the steps are perceptually
  even, not just numerically even.
- **Extract from an image** — drop, paste or upload. k-means++ in OKLab over-clusters to 10,
  then picks 5 by prominence × distinctness, so you don't get five shades of the same sky.
- **Tints & shades** — an 11-step scale per colour, *anchored*: the step nearest your colour
  **is** your colour, so `--x-600` and `--x` are never two different things.
- **Contrast** — every pair as a WCAG 2.1 matrix, plus APCA Lc for the pair you select, with a
  one-click lightness nudge to reach AA.
- **Colour-vision simulation** — protanopia, deuteranopia, tritanopia, achromatopsia
  (Machado 2009 matrices, applied in linear RGB). View-only; your hexes never change.
- **Preview** — the palette mapped onto a real interface, light or dark.
- **Blends** — the interpolated road between the selected swatch and each of the others.
- **Export** — CSS custom properties (hex + `oklch()`), Tailwind v4 `@theme` *and* a v3 config,
  JSON (with scales and contrast data), a plain hex list, and an SVG swatch sheet.
- **Share** — the palette lives in the URL hash. **Save** — the library lives in localStorage.

## Keyboard

| | |
|---|---|
| `Space` | generate |
| `1`–`5` | lock / unlock a swatch |
| `←` `→` | select a swatch |
| `C` | copy the selected hex |
| `R` | reroll just the selected swatch |
| `Z` / `Shift+Z` | undo / redo |
| `S` | save to library |
| `I` | open the image picker |
| `\` | collapse the panel |
| `Q` `W` `E` `X` `L` | inspect · preview · contrast · export · library |

## Build

```sh
npm install
node build.mjs      # src/ → docs/
npx http-server docs -p 8900 -c-1
```

`docs/` is what GitHub Pages serves. No framework — vanilla JS bundled by esbuild, with
[culori](https://culorijs.org/) for colour conversion and
[color-name-list](https://github.com/meodai/color-names) for the 4,959 swatch names.

## Notes

Motion honours `prefers-reduced-motion`, with an override in the status bar — some Windows
configurations report `reduce` when the user never asked for it, and the animation is worth
seeing.
