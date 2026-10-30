# fuel_economy

Reading fuel pump displays from photos.

- `web/`: **Fuel Photo Log**, a browser app that reads pump photos locally and
  exports a CSV. Start here: [web/README.md](web/README.md), plus
  [web/TECHNICAL.md](web/TECHNICAL.md) for how detection works and its limits.
- `images/`: sample pump photos, also used as the regression test set.
- `src/`: the original Python + OpenCV experiments (`pump_ocr.py`,
  `ocr_segment.py`). Kept for reference; the web app's detector is a TypeScript
  port of their approach.
