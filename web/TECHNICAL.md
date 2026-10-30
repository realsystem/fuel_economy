# Technical summary

## 1. Starting point and what was reused

The repository had two Python + OpenCV scripts, written as desktop debugging
tools (every step opens a `cv2.imshow` window):

| Script | Approach | Measured on the 8 photos |
|---|---|---|
| `src/pump_ocr.py` | Canny → largest contour as screen → adaptive threshold → split lines at the emptiest row → Tesseract per line → decimal point found geometrically | 1/8 fully correct |
| `src/ocr_segment.py` | fixed threshold → contours filtered by absolute pixel size → 7-segment lookup table | 0/8 (size filters fit a single photo) |

Neither script could run in a browser as-is. The approach was ported to
TypeScript, keeping both scripts' ideas:

- **from `pump_ocr.py`**: crop to the screen, adaptive mean threshold
  (`ADAPTIVE_THRESH_MEAN_C`), split into lines by row projection, crop each
  line to its digit components, find the decimal point as a small blob and
  insert it by position;
- **from `ocr_segment.py`**: decode each digit by testing which of its seven
  segments are lit against `DIGITS_LOOKUP`.

Changes made so it works across photos:

- every size is relative to the line height instead of absolute pixels;
- italic digits are straightened with a shear search before digits are
  separated;
- photos taken at an angle are handled by fitting the line's top and bottom
  edges (robust Theil–Sen fit) instead of assuming they are level;
- each digit is matched to the *closest* segment pattern with a score and a
  runner-up, instead of needing an exact match;
- the display is found as the largest bright, well-filled region. If the bezel
  is also bright, an inner region is tried, and the whole frame is the last
  resort. The most convincing reading wins.

**Tesseract was dropped.** On these displays it was the weaker reader, and it
would add a multi-megabyte WASM engine and language model to the page.

**OpenCV was replaced by plain TypeScript.** The pipeline needs only a handful
of operations (threshold, connected components, projections, shear), so a full
OpenCV.js build (~8 MB) was not worth it. A practical constraint also applied:
package registries were unreachable while this was built. An OpenCV.js
provider can still be added later behind the same interface (see §4).

The Python scripts are left unchanged in `src/` for reference.

## 2. Pipeline

```
File → validate type/size → decode in worker (scaled to ≤1440 px)
     → max(R,G,B) channel, scale to 900 px
     → display candidates (bright region / inner region / whole frame)
     → adaptive threshold; remove bezel, frame lines, glare streaks, specks
     → text lines from row projection
     → per line: shear search → column runs → digit cells
                 → drop cells off the fitted top/bottom edges
                 → 7-segment decode with score + runner-up
                 → decimal point = small compact blob in a gap on the baseline
     → pick the best candidate
     → classify: arithmetic (3 numbers) > decimal places (2 = money,
       3 = volume) > layout (amount on top)
     → plausibility of implied unit price → status ok / partial / no_numbers / error
```

All of it is pure functions over typed arrays (`src/processor`), with no DOM
and no global state.

## 3. Accuracy (measured, not estimated)

`npm run accuracy` on the 8 photos in `images/`:

| | |
|---|---|
| photos | 8 |
| amount and volume both correct | 8 |
| incorrect values | 0 |
| flagged for review | 1 (fuel2: a faint "ghost" top segment makes the 4 look like a 9; the reading is correct but flagged) |
| wrong but not flagged | 0 |

**Caveat:** the parameters were tuned on these same 8 photos, so this figure
is optimistic. Two extra checks guard against over-fitting:

- `npm run robustness` re-reads the photos half and double size, rotated ±3°,
  blurred, darkened and as quality-30 JPEGs: **61/64 correct, and all 3 misses
  were flagged for review.**
- The unit tests render synthetic displays with numbers not in the photo set
  (upright, italic, different backlight colours) and check they read correctly.

Real accuracy on new pumps is unknown until more photos are added. The most
useful next step is to collect 30–50 photos from different pumps and add them
to `images/` with expected values.

## 4. Ready for backend offloading

- `ImageProcessingService` (`src/services/ImageProcessingService.ts`) is the
  only thing the UI calls. The rule that results never reject (per-image
  failures come back as data) keeps batch handling identical for any provider.
- `ProcessingResult` is versioned (`schemaVersion`), plain JSON, records which
  `processor` produced it, and reports boxes in original-image pixels. A server
  can return exactly the same structure.
- The detector (`processRgba`) is pure TypeScript with no browser APIs, so the
  same code runs under Node on a server unchanged (the tests already run it
  under Node).
- **Fit with `realsystem/processor`:** that project's control plane accepts
  jobs (`POST /api/v1/jobs` with `job_type` + `input_metadata`), and its
  data-plane worker runs them through an executor registry. A
  `RemoteProcessingService` would submit a `fuel_ocr` job, poll
  `GET /api/v1/jobs/:id`, and map the output to `ProcessingResult`. A
  `fuel_ocr` executor in the worker would run this pipeline (or a stronger
  model). Things to resolve first: image transfer (job inputs are JSON
  metadata, so images would need base64 encoding or separate storage),
  authentication from a public page, and the privacy promise. Remote
  processing must be opt-in, with clear wording.

Not built yet, by design: backend, storage, accounts, persistence.

## 5. Extensibility notes

- `ProcessingResult.subject` (`'fuel_pump'`) and the open-ended `FieldKind`
  allow odometer photos to reuse the same result shape, e.g. a `subject:
  'odometer'` result with an `odometer` field.
- `StatisticsService` depends only on `FuelRecord`, not on processing, so
  consumption (MPG, L/100 km) can be added there once odometer readings exist.
- Processing parameters are in `src/processor/config.ts` and app limits are in
  `src/app/appConfig.ts`.

## 6. Known limitations

**Display types**

- Only **7-segment** digits are read. Dot-matrix, LED-matrix, and
  proportional-font LCD displays will fail. They are mostly flagged as review
  or "no numbers".
- Digits must be **darker than the backlight** (the usual LCD). Light-on-dark
  displays (LED or VFD) are not handled yet; supporting them needs an inverted
  threshold pass as an extra candidate.
- Faint "ghost" segments (unlit segments that are still slightly visible) can
  make a digit look like another (4/9, 7/9, 0/8). These cases are flagged.
- Fonts whose vertical segments are much shorter than the horizontal bars may
  lose a leading or trailing 1, 4 or 7 to the alignment filter that removes
  stray marks.

**Layouts**

- Field classification assumes US-style conventions: money to 2 decimals,
  volume to 3, and, when that is not enough, amount above volume. Pumps that
  show litres to 2 decimals, or that show the unit price, may be misclassified.
  The confidence will be lower and the status Review. Three-number displays
  classify reliably when amount ≈ volume × price holds.
- Displays with more than 3 numeric lines read only the 3 most prominent.
- The plausible unit-price range (0.5–15 per unit) is only used to lower
  confidence. Non-US currencies may need it changed in `config.ts`.

**Image quality**

- Severe perspective, heavy glare across digits, strong reflections, motion
  blur and very small digits (under about 20 px tall) reduce accuracy.
- A decimal point touching a digit is not detected separately. It is then
  placed by convention and flagged.
- Rotations beyond a few degrees are not corrected.

**App**

- No persistence: reloading the page clears everything (by design for v1).
- Processing timeout and cancellation stop the worker. In the main-thread
  fallback (browsers without worker canvas support) an image cannot be
  interrupted mid-way.
- No donation provider yet; the button is a placeholder (`APP_CONFIG.supportUrl`).
