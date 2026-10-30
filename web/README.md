# Fuel Photo Log

A small browser utility that reads fuel pump displays from photos. You upload
photos, it reads the numbers locally, you check and correct them, and you
export a CSV.

- **Private.** Photos are processed in your browser and never uploaded. The
  page has a Content-Security-Policy that blocks connections to other hosts.
  There is no analytics and no account.
- **Small.** About 240 KB of JavaScript, mostly React. No OpenCV or Tesseract
  download, and it works offline once loaded.
- **Honest.** Uncertain readings are flagged for review instead of being passed
  off as correct. Corrections are kept next to the detected values, never in
  place of them.

## Requirements

Node.js 20 or newer.

## Install and run

```bash
cd web
npm install
npm run dev        # http://localhost:5173, rebuilds on change
```

## Build and deploy

```bash
npm run build      # writes static files to web/dist/
```

`dist/` contains only static files (`index.html`, `app.js`, `worker.js`,
`styles.css`). Host it anywhere that serves static files: GitHub Pages,
Netlify, Cloudflare Pages, nginx, or an S3 bucket. No server-side code is
needed. Serve it over HTTPS, because some mobile browsers restrict workers on
plain HTTP.

## Tests and reports

```bash
npm test             # unit tests + regression test over ../images
npm run typecheck    # TypeScript type check
npm run accuracy     # per-photo accuracy report on the regression photos
npm run robustness   # same photos under scale/rotation/blur/darkening/JPEG distortion
npm run debug-images -- /tmp/out   # dump each photo's cropped display and binary mask
```

The regression photos live in `../images` and their expected values are in
`test/fixtures/expected.json`. To add a photo, put it in `images/`, add its
expected values to that file, and run `npm run accuracy`.

## How to use

1. Drag photos onto the upload area, or use **Browse files**. You can remove
   any image before processing.
2. Click **Process images**. Photos are read one at a time, with a progress bar
   and a **Cancel** button.
3. Check the results table:
   - a green / amber / red dot shows confidence in a detected value;
   - **edited** marks a value you changed. Hovering shows what was detected,
     and clearing the box reverts to it;
   - **calc** marks a unit price calculated as amount ÷ volume;
   - status **Review** means something needs checking (the note says what),
     and **Detected** means the reading looks consistent.
   - Click a photo to see the original with the detected numbers outlined.
4. Click **Confirm** on each correct row, or **Confirm N detected** to confirm
   all of them. Only confirmed rows count in the final statistics.
5. Click **Export CSV**.

Nothing is stored. Reloading the page clears everything.

## Project layout

```
web/
  build.mjs                 esbuild build / dev server
  public/                   index.html, styles.css
  src/
    app/                    React UI (App + components) and appConfig.ts
    processor/              detection pipeline (no DOM, no React)
      image.ts                pixel primitives (threshold, components, shear…)
      ImagePreprocessor.ts    normalise, find the display, binarise
      NumberDetector.ts       lines → digits → 7-segment decoding → decimal point
      ResultNormalizer.ts     numbers → amount / volume / unit price + confidence
      ImageProcessor.ts       full pipeline on RGBA pixels
      config.ts               tunable parameters
      decode.ts, runOnBlob.ts browser image decoding
    models/                 ProcessingResult, FuelRecord, ProcessingError
    services/               ImageProcessingService interface + browser provider,
                            records, statistics, CSV export
    workers/                Web Worker entry and message protocol
    utils/                  validation, number parsing/formatting
  test/                     node:test suites, synthetic display renderer, fixtures
  scripts/                  accuracy, robustness and debug tools (Node)
```

See [TECHNICAL.md](TECHNICAL.md) for how detection works, measured accuracy,
known limitations, and what is ready for moving processing to a backend.
