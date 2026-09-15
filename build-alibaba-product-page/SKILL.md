---
name: build-alibaba-product-page
description: Build local product detail pages from Alibaba.com product detail pages already opened in Google Chrome. Use when the user asks to create or update a product page in the first-machinery Astro project using Alibaba source content, capture Alibaba images, convert/name WebP assets, add ALT text, copy an existing product detail template, and validate desktop/mobile behavior.
---

# Build Alibaba Product Page

## Purpose

Use this skill to turn an Alibaba product detail page into a local Astro product page for the `first-machinery` project. The expected workflow is: capture the Alibaba tab through Chrome CDP, extract product data and images, copy the current accepted product-page template, replace product-specific content, and verify build plus browser behavior.

## Project Assumptions

- Work in `/Users/gaosong/Projects/first-machinery` unless the user gives another project path.
- Alibaba capture tooling already exists in `scripts/alibaba-capture-current-page.mjs`.
- Manual Chrome capture uses CDP endpoint `http://127.0.0.1:9224`.
- Product pages live under `src/pages/products/filling-machine/water-filling-machine/`.
- Product assets live under `public/assets/first-machinery/products/water-filling-machine/<product-slug>/`.
- The latest accepted rich template is usually `2000bph-water-filling-machine.astro`, `4000bph-water-filling-machine.astro`, or the most recently completed page.

## Workflow

1. Confirm the Alibaba tab is visible to CDP:

```bash
node scripts/alibaba-capture-current-page.mjs --list
```

If the target product is not listed, ask the user to open it in the project’s manual Alibaba Chrome window. Do not scrape a random search result as a substitute.

2. Capture the target page by product ID or URL fragment:

```bash
node scripts/alibaba-capture-current-page.mjs <product-id>
```

The capture writes to `data/alibaba/manual-captures/<slug>/` and downloads candidate images as WebP under that capture’s `assets/` directory.

3. Read the captured data:

- `page-data.json`: product subject, Alibaba attributes, text sample, media items.
- `capture-summary.json`: downloaded image list, dimensions, video cover/video ID.
- Optional: create a contact sheet from downloaded assets before choosing images.

Use Alibaba attributes for exact page data. Common fields:

- `machinery capacity` from text/options.
- `power` from text/options.
- `filling nozzle` from `productBasicProperties`.
- `Filling Volume` from `productBasicProperties`.
- `Voltage`, `Material`, `Warranty`, inspection fields, and after-sales support.

4. Create the asset directory:

```bash
mkdir -p public/assets/first-machinery/products/water-filling-machine/<product-slug>
```

5. Copy captured WebP files into semantic file names. Prefer Alibaba main-gallery assets for Hero thumbnails. Avoid mixing detail-section production-line images into the Hero gallery.

Recommended naming pattern:

- `<slug>-main.webp`
- `<slug>-overview.webp`
- `<slug>-rinsing-system.webp`
- `<slug>-front-view.webp`
- `<slug>-filling-valve.webp`
- `<slug>-capping-system.webp`
- `<slug>-video-cover.webp`
- `<slug>-machine-details-overview.webp`
- `<slug>-automatic-rinsing-system-detail.webp`
- `<slug>-high-speed-reflux-filling-valve-detail.webp`
- `<slug>-automatic-capping-system-detail.webp`
- `<slug>-complete-line-layout.webp`
- `<slug>-water-treatment-system.webp`
- `<slug>-labeling-machine.webp`
- `<slug>-packaging-system.webp`
- `<slug>-bottle-blowing-machine.webp`
- `<slug>-core-component-brands.webp`
- `<slug>-factory.webp`
- `<slug>-certifications.webp`
- `<slug>-global-customers.webp`

When selecting machine detail cards, use actual machine-detail images from the supplier detail materials, not unrelated bottle blowing or packaging images.

6. Build the page from an accepted rich template:

- Copy a completed rich page such as `4000bph-water-filling-machine.astro`.
- Replace product name, slug, product URL, product ID, SKU, schema description, metadata description, hero stats, key specs, FAQ, inquiry copy, WhatsApp text, and all asset paths.
- Keep shared UX patterns intact unless the user asks otherwise: centered Hero title, stats row, image gallery, quote form, bottom inquiry section, sticky CTA, mobile quote modal, collapsed technical specification section, country code dropdown defaulting to `🇺🇸 +1`.

7. ALT text requirements:

- Every visible image should have a specific ALT describing the machine section and capacity.
- Hero thumbnails can use empty ALT only when the corresponding button has an accessible label and the main image has descriptive ALT.
- Avoid generic ALT such as `product image`.

8. Validate:

```bash
npm run build
```

Then verify with Playwright/Chrome:

- Desktop page loads at the requested local URL.
- `h1` matches product name.
- Stats match captured Alibaba values.
- Hero thumbnail count matches the intended Alibaba main gallery, usually 6.
- Country selector defaults to `🇺🇸 +1`.
- Mobile sticky CTA appears after scroll.
- Mobile Get Quote opens the modal form.
- Referenced image files all exist.

## Common Pitfalls

- Do not trust mechanical replacements alone. Re-read top constants and search for old capacity/product IDs.
- Do not replace SVG path numbers by broad regex. Limit text replacements to product strings and data values.
- Alibaba detail pages often contain unrelated platform icons and chat avatars; exclude tiny icons and non-product UI assets.
- If direct network or CDP access fails in sandbox, rerun the capture or browser validation command with the required escalation.
- If the dev toolbar intercepts mobile Playwright clicks, use DOM `element.click()` for validation or test a production build.
- Keep existing user changes in the repo; never revert unrelated edits.
