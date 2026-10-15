import { test, expect, type Page } from '@playwright/test';

// Text-heavy 2-page PDF generated via PyMuPDF with structured headings, paragraphs, and exact metrics
const TEXT_HEAVY_PDF_B64 =
  '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';

test.describe('Manual Testing Corrections — PDF Reader Viewport, Text Alignment & Links', () => {
  const docId = 'doc-manual-text-heavy';
  const moduleSlug = 'os-sys';

  const setupTestEnvironment = async (page: Page) => {
    // Authenticated user
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-tester',
          username: 'tester_manual',
          email: 'tester@example.com',
          first_name: 'Manual',
          family_name: 'Tester',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-tester', status: 'ACTIVE', role: 'MEMBER' },
          capabilities: {},
        },
      });
    });

    // Mock module info
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-os', community_id: 'irm', name: 'Operating Systems', slug: moduleSlug },
      });
    });

    // Mock document metadata
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Advanced Operating Systems Lecture Notes',
          module_id: 'mod-os',
          uploader_id: 'u-tester',
          type: 'COURSE',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-10-01T10:00:00Z',
          updated_at: '2026-10-01T10:00:00Z',
        },
      });
    });

    const pdfBuffer = Buffer.from(TEXT_HEAVY_PDF_B64, 'base64');
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      const headers = route.request().headers();
      if (headers['range']?.startsWith('bytes=0-0')) {
        await route.fulfill({
          status: 206,
          headers: {
            'content-type': 'application/pdf',
            'content-range': `bytes 0-0/${pdfBuffer.length}`,
            'content-length': '1',
            'accept-ranges': 'bytes',
          },
          body: pdfBuffer.subarray(0, 1),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-length': `${pdfBuffer.length}`,
          },
          body: pdfBuffer,
        });
      }
    });
  };

  for (const dpr of [1, 2]) {
    test.describe(`Actual device-pixel ratio ${dpr}`, () => {
      test.use({ deviceScaleFactor: dpr });
      test('Defect 1: PDF canvas and selectable text layer alignment across zoom, page changes, and DPR', async ({
        page,
      }, testInfo) => {
        await setupTestEnvironment(page);
        await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

        // Wait for PDF to render
        const canvas = page.locator('canvas[data-testid="pdf-canvas"]');
        await expect(canvas).toBeVisible({ timeout: 10000 });
        const textLayer = page.locator('.textLayer');
        await expect(textLayer).toBeVisible();

        // Verify selectable text spans exist
        const headingSpan = textLayer.locator('span', { hasText: 'Advanced Operating Systems' }).first();
        await expect(headingSpan).toBeAttached();

        // Verify text spans are rendered with transparent color (not opaque black superimposed)
        const spanStyles = await headingSpan.evaluate((el) => {
          const computed = window.getComputedStyle(el);
          return {
            color: computed.color,
            position: computed.position,
            whiteSpace: computed.whiteSpace,
            transformOrigin: computed.transformOrigin,
          };
        });

        expect(spanStyles.color).toBe('rgba(0, 0, 0, 0)');
        expect(spanStyles.position).toBe('absolute');
        expect(spanStyles.whiteSpace).toBe('pre');

        // Verify canvas CSS dimensions and text-layer dimensions match the logical viewport exactly
        const dimensions = await page.evaluate(() => {
          const c = document.querySelector('canvas[data-testid="pdf-canvas"]') as HTMLCanvasElement;
          const t = document.querySelector('.textLayer') as HTMLDivElement;
          return {
            canvasWidth: c.offsetWidth,
            canvasHeight: c.offsetHeight,
            canvasBufferWidth: c.width,
            canvasBufferHeight: c.height,
            textLayerWidth: t.offsetWidth,
            textLayerHeight: t.offsetHeight,
            scaleFactor: t.style.getPropertyValue('--scale-factor'),
          };
        });

        expect(dimensions.canvasWidth).toBe(dimensions.textLayerWidth);
        expect(dimensions.canvasHeight).toBe(dimensions.textLayerHeight);
        expect(Number(dimensions.scaleFactor)).toBeCloseTo(1.0, 1);
        // Buffer width must be scaled by DPR relative to CSS display width
        expect(dimensions.canvasBufferWidth).toBeGreaterThanOrEqual(dimensions.canvasWidth);
        expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr);
        expect(dimensions.canvasBufferWidth).toBeCloseTo(dimensions.canvasWidth * dpr, 0);

        // Verify selection highlights align with printed text
        const textSelectionResult = await page.evaluate(() => {
          const textContainer = document.querySelector('.textLayer') as HTMLElement;
          const span = textContainer.querySelector('span') as HTMLElement;
          if (!span) return null;

          // Select text in the first span
          const range = document.createRange();
          range.selectNodeContents(span);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);

          const selectedText = sel?.toString() || '';
          const rangeRect = range.getBoundingClientRect();
          const spanRect = span.getBoundingClientRect();

          return {
            selectedText,
            rangeRect: { x: rangeRect.x, y: rangeRect.y, w: rangeRect.width, h: rangeRect.height },
            spanRect: { x: spanRect.x, y: spanRect.y, w: spanRect.width, h: spanRect.height },
          };
        });

        expect(textSelectionResult).not.toBeNull();
        expect(textSelectionResult?.selectedText.length).toBeGreaterThan(0);
        // The selection bounding rect matches the span bounding rect
        expect(textSelectionResult?.rangeRect.w).toBeCloseTo(textSelectionResult!.spanRect.w, 1);
        await page.screenshot({ path: testInfo.outputPath(`pdf-selected-100-dpr${dpr}.png`), fullPage: true });

        // Zoom in to 125% and verify alignment is preserved
        await page.getByRole('button', { name: 'Zoom in' }).click();
        await page.waitForTimeout(400);

        const zoomedDimensions = await page.evaluate(() => {
          const c = document.querySelector('canvas[data-testid="pdf-canvas"]') as HTMLCanvasElement;
          const t = document.querySelector('.textLayer') as HTMLDivElement;
          return {
            canvasWidth: c.offsetWidth,
            canvasHeight: c.offsetHeight,
            textLayerWidth: t.offsetWidth,
            textLayerHeight: t.offsetHeight,
            scaleFactor: t.style.getPropertyValue('--scale-factor'),
          };
        });

        expect(Math.abs(zoomedDimensions.canvasWidth - zoomedDimensions.textLayerWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(zoomedDimensions.canvasHeight - zoomedDimensions.textLayerHeight)).toBeLessThanOrEqual(1);
        expect(Number(zoomedDimensions.scaleFactor)).toBeCloseTo(1.25, 1);
        await headingSpan.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        });
        await page.screenshot({ path: testInfo.outputPath(`pdf-selected-125-dpr${dpr}.png`), fullPage: true });

        // Switch to page 2 and verify stale spans are purged and page 2 text appears
        await page.getByRole('button', { name: 'Next page' }).click();
        await page.waitForTimeout(400);

        const page2Heading = textLayer.locator('span', { hasText: 'Distributed Systems Consensus' }).first();
        await expect(page2Heading).toBeAttached();
        // Page 1 heading must not be present in page 2 textLayer
        await expect(textLayer.locator('span', { hasText: 'Memory Virtualization' })).toHaveCount(0);

        // Take screenshot for visual alignment evidence
        await page.screenshot({ path: testInfo.outputPath(`pdf-page2-dpr${dpr}.png`), fullPage: true });
      });
    });
  }

  test('Defect 2: New-tab link renders cleanly without literal entity string &nearr; and keeps accessible label', async ({
    page,
  }) => {
    await setupTestEnvironment(page);
    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

    const newTabLink = page.getByRole('link', { name: 'Open in new tab' });
    await expect(newTabLink).toBeVisible();

    // Verify it links to the authorized /view endpoint with security attributes
    await expect(newTabLink).toHaveAttribute('href', new RegExp(`/api/v1/documents/${docId}/view$`));
    await expect(newTabLink).toHaveAttribute('target', '_blank');
    await expect(newTabLink).toHaveAttribute('rel', 'noopener noreferrer');

    // Assert that the literal raw entity string &nearr; is NOT visibly displayed as text
    const linkInnerHtml = await newTabLink.innerHTML();
    const linkInnerText = await newTabLink.innerText();

    expect(linkInnerText).not.toContain('&nearr;');
    expect(linkInnerText).not.toContain('&');
    expect(linkInnerHtml).not.toContain('&amp;nearr;');

    // Verify decorative SVG arrow has aria-hidden="true"
    const svgIcon = newTabLink.locator('svg');
    await expect(svgIcon).toBeVisible();
    await expect(svgIcon).toHaveAttribute('aria-hidden', 'true');
  });

  test('Defect 3: Reader viewport remains stable and does not shift controls or trigger downloads on repeated zoom clicks', async ({
    page,
  }) => {
    await setupTestEnvironment(page);

    let downloadTriggered = false;
    let newTabTriggered = false;

    page.on('download', () => {
      downloadTriggered = true;
    });
    page.on('popup', () => {
      newTabTriggered = true;
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible({ timeout: 10000 });

    const zoomOutBtn = page.getByRole('button', { name: 'Zoom out' });
    const zoomInBtn = page.getByRole('button', { name: 'Zoom in' });
    const fitWidthBtn = page.getByRole('button', { name: 'Fit to width' });
    const downloadBtn = page.getByRole('button', { name: 'Download Original' });

    // Initial position of Zoom out button at 100%
    const initialZoomOutRect = await zoomOutBtn.boundingBox();
    expect(initialZoomOutRect).not.toBeNull();

    // Initial height of the scrollable viewer container
    const initialContainerHeight = await page.evaluate(() => {
      const el = document.querySelector('div[aria-label^="PDF Viewer:"]') as HTMLElement;
      return el.offsetHeight;
    });

    // Repeated zoom out clicks: 100% -> 75% -> 50% (minimum)
    await zoomOutBtn.click();
    await page.waitForTimeout(200);

    const step1Rect = await zoomOutBtn.boundingBox();
    expect(step1Rect?.y).toBeCloseTo(initialZoomOutRect!.y, 0); // Position must not shift vertically
    expect(step1Rect?.x).toBeCloseTo(initialZoomOutRect!.x, 0);

    await zoomOutBtn.click();
    await page.waitForTimeout(200);

    const step2Rect = await zoomOutBtn.boundingBox();
    expect(step2Rect?.y).toBeCloseTo(initialZoomOutRect!.y, 0);
    expect(step2Rect?.x).toBeCloseTo(initialZoomOutRect!.x, 0);

    // Zoom out is now disabled at minimum scale (50%)
    await expect(zoomOutBtn).toBeDisabled();

    // Verify container height remained stable and did not collapse with smaller canvas
    const containerHeightAtMin = await page.evaluate(() => {
      const el = document.querySelector('div[aria-label^="PDF Viewer:"]') as HTMLElement;
      return el.offsetHeight;
    });
    expect(containerHeightAtMin).toBe(initialContainerHeight);

    // Repeated clicks on disabled button must not accidentally activate Download or open new tabs
    await zoomOutBtn.click({ force: true });
    await zoomOutBtn.click({ force: true });
    await zoomOutBtn.click({ force: true });

    expect(downloadTriggered).toBe(false);
    expect(newTabTriggered).toBe(false);

    // Repeated zoom in clicks up to 150%
    await zoomInBtn.click();
    await page.waitForTimeout(200);
    await zoomInBtn.click();
    await page.waitForTimeout(200);
    await zoomInBtn.click();
    await page.waitForTimeout(200);

    const stepZoomInRect = await zoomOutBtn.boundingBox();
    expect(stepZoomInRect?.y).toBeCloseTo(initialZoomOutRect!.y, 0);

    // Fit Width
    await fitWidthBtn.click();
    await page.waitForTimeout(200);
    const fitWidthRect = await zoomOutBtn.boundingBox();
    expect(fitWidthRect?.y).toBeCloseTo(initialZoomOutRect!.y, 0);

    // Assert that Download Original button is still intact and never activated
    await expect(downloadBtn).toBeEnabled();
    expect(downloadTriggered).toBe(false);
    expect(newTabTriggered).toBe(false);
  });

  test('Defect 3 responsive: Viewport stability across mobile (320px, 390px), tablet (768px), and short viewports', async ({
    page,
  }) => {
    await setupTestEnvironment(page);

    const viewports = [
      { width: 320, height: 600 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 500 }, // short viewport height
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);
      await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible({ timeout: 10000 });

      const zoomOut = page.getByRole('button', { name: 'Zoom out' });
      await expect(zoomOut).toBeVisible();

      const getDocY = async () => {
        const box = await zoomOut.boundingBox();
        const scrollY = await page.evaluate(() => window.scrollY);
        return box ? box.y + scrollY : 0;
      };

      const y1 = await getDocY();
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.waitForTimeout(150);
      const y2 = await getDocY();
      await zoomOut.click();
      await page.waitForTimeout(150);
      const y3 = await getDocY();

      // Controls must stay at same document layout position across zoom
      expect(y2).toBeCloseTo(y1, 0);
      expect(y3).toBeCloseTo(y1, 0);

      // Verify no horizontal document-level scrollbar created
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // small tolerance for browser subpixel rounding
    }
  });
});
