import { test, expect, type Page } from '@playwright/test';

const TWO_PAGE_PDF_B64 =
  'JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMgoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMik+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDIvS2lkc1s0IDAgUiA4IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDwvRm9udDw8L2hlbHYgNSAwIFI+Pj4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1JvdGF0ZSAwL1Jlc291cmNlcyAzIDAgUi9QYXJlbnQgMiAwIFIvQ29udGVudHNbNiAwIFJdPj4KZW5kb2JqCgo1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYS9FbmNvZGluZy9XaW5BbnNpRW5jb2Rpbmc+PgplbmRvYmoKCjYgMCBvYmoKPDwvTGVuZ3RoIDExMS9GaWx0ZXIvRmxhdGVEZWNvZGU+PgpzdHJlYW0KeNoVizEKQkEMRPucIjcwySYTP4jFBxs7YTuxEP8uFlrYeH4j0zzmzdCH1k7KUlEO4XTj/qbdc7y+rHvuk6+HECgSYdK03U18wUhPw4RnoKVjKR4mRfPvw3wzqd8DWh0wa70db/1Mp04X+gFKdBtKCmVuZHN0cmVhbQplbmRvYmoKCjcgMCBvYmoKPDwvRm9udDw8L2hlbHYgNSAwIFI+Pj4+CmVuZG9iagoKOCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1JvdGF0ZSAwL1Jlc291cmNlcyA3IDAgUi9QYXJlbnQgMiAwIFIvQ29udGVudHNbOSAwIFJdPj4KZW5kb2JqCgo5IDAgb2JqCjw8L0xlbmd0aCAxMDYvRmlsdGVyL0ZsYXRlRGVjb2RlPj4Kc3RyZWFtCnjaHYk7CsJgEAb7PcXewH1+a0AsAjZ2wnYhhUiChRY2nt8fmWpm6ENzk7IMlFO4wrjfdHhury/rkXvn5ZQCRSFN3PxuEooojLbBkQiTDOwlmODlJv8zagSyYtiER/l57Stdmm70A/GkGeIKZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDEwCjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA0MiAwMDAwMCBuIAowMDAwMDAwMTIwIDAwMDAwIG4gCjAwMDAwMDAxNzggMDAwMDAgbiAKMDAwMDAwMDIxOSAwMDAwMCBuIAowMDAwMDAwMzI2IDAwMDAwIG4gCjAwMDAwMDA0MTUgMDAwMDAgbiAKMDAwMDAwMDU5NSAwMDAwMCBuIAowMDAwMDAwNjM2IDAwMDAwIG4gCjAwMDAwMDA3NDMgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSAxMC9Sb290IDEgMCBSL0lEWzw3QTEzMkI2NzI1QzNBRDEyNkRDMzk3QzM5NkMzQjg2Mj48QjA3MzA5OEJDNjU0RjJEQzc3NDAyQjlCRTc5NEUzQ0Q+XT4+CnN0YXJ0eHJlZgo5MTgKJSVFT0YK';

const SAMPLE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGACDMAWcAAA==';

const SAMPLE_JPG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAACAAIBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function createMixedRotatedPdf() {
  const pages = [
    { width: 595, height: 842, rotation: 0 },
    { width: 842, height: 1000, rotation: 90 },
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ];
  pages.forEach((pdfPage, index) => {
    const pageObject = 3 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPage.width} ${pdfPage.height}] /Rotate ${pdfPage.rotation} /Resources << >> /Contents ${pageObject + 1} 0 R >>`);
    objects.push('<< /Length 0 >>\nstream\n\nendstream');
  });

  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

test.describe('Task 2.2: Approved Document Reader Inside IRM Hub', () => {

  const setupAuthRoutes = async (page: Page) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-member',
          username: 'student_member',
          email: 'student@example.com',
          first_name: 'Student',
          family_name: 'IRM',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-member', status: 'ACTIVE', role: 'MEMBER' },
          capabilities: {},
        },
      });
    });
  };

  test('Embedded PDF Reader automatically loads, navigates pages, and zooms', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-pdf-123';
    const moduleSlug = 'advanced-c';

    // Mock module info
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    // Mock document metadata
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Advanced Pointer Techniques',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'COURSE',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    // Mock document view endpoint (supporting range requests)
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');

    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      const headers = route.request().headers();
      const range = headers['range'];

      if (range && range.startsWith('bytes=0-0')) {
        await route.fulfill({
          status: 206,
          headers: {
            'content-type': 'application/pdf',
            'content-range': `bytes 0-0/${pdfBuffer.length}`,
            'content-length': '1',
            'content-disposition': 'inline; filename="Advanced Pointer Techniques.pdf"',
            'cache-control': 'private, no-store',
            'accept-ranges': 'bytes',
          },
          body: pdfBuffer.subarray(0, 1),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'inline; filename="Advanced Pointer Techniques.pdf"',
            'cache-control': 'private, no-store',
            'accept-ranges': 'bytes',
          },
          body: pdfBuffer,
        });
      }
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

    // 1. Verify title and metadata visible
    await expect(page.getByRole('heading', { name: 'Advanced Pointer Techniques' })).toBeVisible();
    await expect(page.getByText('PDF Document — 2 pages')).toBeVisible();

    // 2. Actions: Open in new tab points to /view, Download uses /download
    const newTabLink = page.getByRole('link', { name: /Open in new tab/i });
    await expect(newTabLink).toBeVisible();
    await expect(newTabLink).toHaveAttribute('href', /.*\/api\/v1\/documents\/doc-pdf-123\/view/);
    await expect(newTabLink).toHaveAttribute('target', '_blank');

    const downloadButton = page.getByRole('button', { name: /Download Original/i });
    await expect(downloadButton).toBeVisible();

    // The first fit must finish so the reader can render and expose zoom controls.
    await expect(page.locator('.ui-reader-toolbar').getByText('Fitting…')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeEnabled();

    // 3. Verify Canvas rendered and has non-empty visual pixel data
    const canvas = page.locator('canvas[data-testid="pdf-canvas"]');
    await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d');
      if (!ctx) return false;
      const imgData = ctx.getImageData(0, 0, Math.min(c.width, 100), Math.min(c.height, 100));
      return imgData.data.some((channel) => channel !== 0);
    })).toBe(true);

    // 4. Verify text layer has Page 1 text
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(page.locator('.textLayer')).toContainText('Page 1: Introduction to IRM Platform');

    // 5. Page navigation: Previous is disabled on page 1, Next is enabled
    const prevBtn = page.getByRole('button', { name: 'Previous page' });
    const nextBtn = page.getByRole('button', { name: 'Next page' });
    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    // 6. Navigate to Page 2
    await nextBtn.click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(nextBtn).toBeDisabled();
    await expect(prevBtn).toBeEnabled();
    await expect(page.locator('.textLayer')).toContainText('Page 2: Advanced Topics and Details');

    // 7. Navigate back to Page 1
    await prevBtn.click();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(page.locator('.textLayer')).toContainText('Page 1: Introduction to IRM Platform');

    // 8. Zoom Controls: Zoom In and Zoom Out
    const zoomInBtn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOutBtn = page.getByRole('button', { name: 'Zoom out' });
    const fitWidthBtn = page.getByRole('button', { name: 'Fit to width' });

    await expect(fitWidthBtn).toHaveAttribute('aria-pressed', 'true');
    const initialScaleText = await page.locator('.ui-reader-toolbar').getByText(/%/).innerText();
    await zoomInBtn.click();
    await expect(fitWidthBtn).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => Number((await page.locator('.ui-reader-toolbar').getByText(/%/).innerText()).replace('%', '')))
      .toBe(Number(initialScaleText.replace('%', '')) + 25);

    await zoomOutBtn.click();
    await expect.poll(async () => Number((await page.locator('.ui-reader-toolbar').getByText(/%/).innerText()).replace('%', '')))
      .toBe(Number(initialScaleText.replace('%', '')));

    await fitWidthBtn.click();
    await expect(fitWidthBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ui-reader-toolbar').getByText(/%/)).toBeVisible();
  });

  test('Embedded Image Viewer displays PNG and JPEG with dimensions preserved', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-png-456';
    const moduleSlug = 'web-development';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-2', community_id: 'irm', name: 'Web Development', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Architecture Schema Diagram',
          module_id: 'mod-2',
          uploader_id: 'u-1',
          type: 'SUMMARY',
          source: 'STUDENT',
          status: 'APPROVED',
          created_at: '2026-03-02T10:00:00Z',
          updated_at: '2026-03-02T10:00:00Z',
        },
      });
    });

    const pngBuffer = Buffer.from(SAMPLE_PNG_B64, 'base64');

    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      const headers = route.request().headers();
      if (headers['range']?.startsWith('bytes=0-0')) {
        await route.fulfill({
          status: 206,
          headers: {
            'content-type': 'image/png',
            'content-range': `bytes 0-0/${pngBuffer.length}`,
            'content-length': '1',
            'content-disposition': 'inline; filename="Architecture Schema Diagram.png"',
            'cache-control': 'private, no-store',
          },
          body: pngBuffer.subarray(0, 1),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-disposition': 'inline; filename="Architecture Schema Diagram.png"',
            'cache-control': 'private, no-store',
          },
          body: pngBuffer,
        });
      }
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

    await expect(page.getByText('Image Document')).toBeVisible();
    const img = page.locator('img[data-testid="document-image"]');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'Architecture Schema Diagram');

    // Zoom controls for image
    const zoomInBtn = page.getByRole('button', { name: 'Zoom in' });
    const resetBtn = page.getByRole('button', { name: 'Reset zoom' });

    await zoomInBtn.click();
    await expect(page.getByText('125%')).toBeVisible();

    await resetBtn.click();
    await expect(page.getByText('100%')).toBeVisible();

    // Also test JPEG document loading
    const jpgDocId = 'doc-jpg-789';
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${jpgDocId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: jpgDocId,
          title: 'Photo Note',
          module_id: 'mod-2',
          uploader_id: 'u-1',
          type: 'COURSE',
          source: 'STUDENT',
          status: 'APPROVED',
          created_at: '2026-03-02T10:00:00Z',
          updated_at: '2026-03-02T10:00:00Z',
        },
      });
    });

    const jpgBuffer = Buffer.from(SAMPLE_JPG_B64, 'base64');
    await page.route(`**/api/v1/documents/${jpgDocId}/view`, async (route) => {
      const headers = route.request().headers();
      if (headers['range']?.startsWith('bytes=0-0')) {
        await route.fulfill({
          status: 206,
          headers: {
            'content-type': 'image/jpeg',
            'content-range': `bytes 0-0/${jpgBuffer.length}`,
            'content-length': '1',
            'content-disposition': 'inline; filename="Photo Note.jpg"',
            'cache-control': 'private, no-store',
          },
          body: jpgBuffer.subarray(0, 1),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-disposition': 'inline; filename="Photo Note.jpg"',
            'cache-control': 'private, no-store',
          },
          body: jpgBuffer,
        });
      }
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${jpgDocId}`);
    await expect(page.getByText('Image Document')).toBeVisible();
    const jpgImg = page.locator('img[data-testid="document-image"]');
    await expect(jpgImg).toBeVisible();
    await expect(jpgImg).toHaveAttribute('alt', 'Photo Note');
  });

  test('Reader failure shows safe error, retry button, and fallback actions', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-fail-789';
    const moduleSlug = 'poo';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-3', community_id: 'irm', name: 'POO', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Damaged Exam Document',
          module_id: 'mod-3',
          uploader_id: 'u-1',
          type: 'EXAM',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-03T10:00:00Z',
          updated_at: '2026-03-03T10:00:00Z',
        },
      });
    });

    let shouldFail = true;
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      if (shouldFail) {
        // Return 500 error on first try
        await route.fulfill({ status: 500 });
      } else {
        // Return valid PDF on retry
        const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');
        const headers = route.request().headers();
        if (headers['range']?.startsWith('bytes=0-0')) {
          await route.fulfill({
            status: 206,
            headers: { 'content-type': 'application/pdf', 'content-range': `bytes 0-0/${pdfBuffer.length}` },
            body: pdfBuffer.subarray(0, 1),
          });
        } else {
          await route.fulfill({
            status: 200,
            headers: { 'content-type': 'application/pdf' },
            body: pdfBuffer,
          });
        }
      }
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

    // Error is displayed with retry button and fallback links
    await expect(page.getByText('Unable to load document from the server')).toBeVisible();
    await expect(page.getByRole('link', { name: /Try opening in new tab/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download file instead/i })).toBeVisible();

    // Click retry
    shouldFail = false;
    const retryBtn = page.getByRole('button', { name: 'Retry Loading' });
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // Recovers successfully
    await expect(page.getByText('PDF Document — 2 pages')).toBeVisible();
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible();
  });

  test('Document Reader fits cleanly at 320px viewport without page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await setupAuthRoutes(page);

    const docId = 'doc-mob-1';
    const moduleSlug = 'advanced-c';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Mobile Reader Document',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'COURSE',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      const headers = route.request().headers();
      if (headers['range']?.startsWith('bytes=0-0')) {
        await route.fulfill({
          status: 206,
          headers: { 'content-type': 'application/pdf', 'content-range': `bytes 0-0/${pdfBuffer.length}` },
          body: pdfBuffer.subarray(0, 1),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/pdf' },
          body: pdfBuffer,
        });
      }
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

    await expect(page.getByText('PDF Document — 2 pages')).toBeVisible();
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible();

    // Verify no page-level horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Controls remain clickable and within viewport
    await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  });

  test('Probe acceptance: server ignores Range header and returns 200 OK without breaking viewer', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-range-200';
    const moduleSlug = 'advanced-c';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Document with 200 Probe',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'COURSE',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');
    // Server returns 200 OK for ALL requests (ignoring Range: bytes=0-0)
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'inline; filename="Document with 200 Probe.pdf"',
          'cache-control': 'private, no-store',
        },
        body: pdfBuffer,
      });
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

    // PDF loads correctly despite server ignoring Range
    await expect(page.getByText('PDF Document — 2 pages')).toBeVisible();
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible();
    await expect(page.locator('.textLayer')).toContainText('Page 1: Introduction to IRM Platform');
  });

  test('Probe acceptance: unsupported format displays safe error and fallback links', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-unsupported-mimetype';
    const moduleSlug = 'advanced-c';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Unknown File Format',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'OTHER',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    // Server returns unsupported MIME type
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      await route.fulfill({
        status: 415,
        headers: { 'content-type': 'application/json' },
        json: { detail: 'Unsupported format' },
      });
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

    await expect(page.getByText('Unsupported document format for inline viewing.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Try opening in new tab/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download file instead/i })).toBeVisible();
  });

  test('Authorization failure clears reader state, canvas, and controls', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-auth-fail';
    const moduleSlug = 'advanced-c';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Protected Exam Paper',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'EXAM',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    // View endpoint returns 401 Unauthorized
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      await route.fulfill({
        status: 401,
        json: { detail: 'Not authenticated' },
      });
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);

    // AccessDeniedGuidance displays login call to action
    await expect(page.getByText('Authentication Needed')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log In' }).last()).toBeVisible();

    // Canvas, textLayer, and reader toolbar controls are cleared and not rendered
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toHaveCount(0);
    await expect(page.locator('.textLayer')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Previous page' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
  });

  test('Lifecycle race: slow Document A followed by rapid navigation to Document B never leaks A into B', async ({ page }) => {
    await setupAuthRoutes(page);

    const moduleSlug = 'advanced-c';
    const docAId = 'doc-race-a';
    const docBId = 'doc-race-b';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docAId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docAId,
          title: 'Document Slow A',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'COURSE',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docBId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docBId,
          title: 'Document Fast B',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'SUMMARY',
          source: 'STUDENT',
          status: 'APPROVED',
          created_at: '2026-03-02T10:00:00Z',
          updated_at: '2026-03-02T10:00:00Z',
        },
      });
    });

    const pngBuffer = Buffer.from(SAMPLE_PNG_B64, 'base64');
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');

    // Document A is delayed
    await page.route(`**/api/v1/documents/${docAId}/view`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        body: pdfBuffer,
      });
    });

    // Document B responds immediately
    await page.route(`**/api/v1/documents/${docBId}/view`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: pngBuffer,
      });
    });

    // Navigate to A, then quickly switch to B
    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docAId}`);
    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docBId}`);

    // Wait for B to display
    await expect(page.getByRole('heading', { name: 'Document Fast B' })).toBeVisible();
    await expect(page.getByText('Image Document')).toBeVisible();
    await expect(page.locator('img[data-testid="document-image"]')).toBeVisible();

    // Wait past Document A's delayed resolution
    await page.waitForTimeout(700);

    // Verify Document A never replaced Document B's image viewer
    await expect(page.getByRole('heading', { name: 'Document Fast B' })).toBeVisible();
    await expect(page.getByText('Image Document')).toBeVisible();
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toHaveCount(0);
  });

  test('Rapid page and zoom changes cancel in-flight render without crashing or duplicating text', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-rapid-actions';
    const moduleSlug = 'advanced-c';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Rapid Action PDF',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'COURSE',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      const headers = route.request().headers();
      if (headers['range']?.startsWith('bytes=0-0')) {
        await route.fulfill({
          status: 206,
          headers: { 'content-type': 'application/pdf', 'content-range': `bytes 0-0/${pdfBuffer.length}` },
          body: pdfBuffer.subarray(0, 1),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/pdf' },
          body: pdfBuffer,
        });
      }
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible();

    const nextBtn = page.getByRole('button', { name: 'Next page' });
    const zoomInBtn = page.getByRole('button', { name: 'Zoom in' });

    // Rapidly click Next and Zoom In in succession
    await nextBtn.click();
    await zoomInBtn.click();
    await zoomInBtn.click();

    // Page 2 settles cleanly
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.locator('.textLayer')).toContainText('Page 2: Advanced Topics and Details');

    // Verify text layer does not contain duplicate instances of the sentence
    const textContent = await page.locator('.textLayer').innerText();
    const occurrences = (textContent.match(/Advanced Topics and Details/g) || []).length;
    expect(occurrences).toBe(1);
  });

  test('Keyboard accessibility: toolbar controls are focusable and announce accessible names', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-a11y-check';
    const moduleSlug = 'advanced-c';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Accessible Document',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'COURSE',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        body: pdfBuffer,
      });
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible();

    // Check accessible names of all controls
    await expect(page.getByRole('link', { name: /Open in new tab/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download Original/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fit to width' })).toBeVisible();

    // Boundary check: Previous page is disabled on Page 1
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    // Tab navigation operates controls via keyboard
    const nextBtn = page.getByRole('button', { name: 'Next page' });
    await nextBtn.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  test('Responsive layout: Fit width adapts across mobile and desktop, preserving manual zoom and page fit', async ({ page }) => {
    await setupAuthRoutes(page);

    const docId = 'doc-responsive-check';
    const moduleSlug = 'advanced-c';

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'irm', name: 'Advanced C', slug: moduleSlug },
      });
    });

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${docId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: docId,
          title: 'Responsive Multi-Breakpoint Document Testing Layout Wrapping',
          module_id: 'mod-1',
          uploader_id: 'u-1',
          type: 'COURSE',
          source: 'OFFICIAL',
          status: 'APPROVED',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
      });
    });

    const pdfBuffer = createMixedRotatedPdf();
    await page.route(`**/api/v1/documents/${docId}/view`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        body: pdfBuffer,
      });
    });

    // Test narrow mobile, standard mobile, and desktop while preserving one open reader.
    const viewports = [
      { width: 320, height: 780 },
      { width: 390, height: 844 },
      { width: 1440, height: 1000 },
    ];

    await page.setViewportSize(viewports[1]);
    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${docId}`);
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible();
    const fitButton = page.getByRole('button', { name: 'Fit to width' });
    const zoomInButton = page.getByRole('button', { name: 'Zoom in' });
    await expect(fitButton).toHaveAttribute('aria-pressed', 'true');

    const reader = page.locator('[aria-label^="PDF Viewer:"]');
    const assertPageFits = async (width: number) => {
      await expect.poll(() => reader.evaluate((element) => {
        const style = getComputedStyle(element);
        const availableWidth = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const canvasWidth = element.querySelector('canvas')?.getBoundingClientRect().width ?? Infinity;
        return canvasWidth <= availableWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
      })).toBe(true);
      const dimensions = await reader.evaluate((element) => {
        const style = getComputedStyle(element);
        const availableWidth = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const canvasWidth = element.querySelector('canvas')?.getBoundingClientRect().width ?? Infinity;
        return { availableWidth, canvasWidth, hasHorizontalScroll: element.scrollWidth > element.clientWidth + 1 };
      });
      expect(dimensions.canvasWidth, `PDF should fit the ${width}px viewport reader`).toBeLessThanOrEqual(dimensions.availableWidth + 1);
      expect(dimensions.hasHorizontalScroll, `Reader should not scroll horizontally at ${width}px`).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        `Page should not overflow horizontally at ${width}px`).toBe(true);
    };

    await page.setViewportSize(viewports[0]);
    await expect.poll(() => fitButton.getAttribute('aria-pressed')).toBe('true');
    await assertPageFits(320);

    await page.setViewportSize(viewports[2]);
    await assertPageFits(1440);

    // Manual zoom survives a resize; choosing Fit width resumes automatic sizing.
    await zoomInButton.click();
    await expect(fitButton).toHaveAttribute('aria-pressed', 'false');
    const manualScale = await page.locator('.ui-reader-toolbar').getByText(/%/).innerText();
    await page.setViewportSize(viewports[0]);
    await expect(page.locator('.ui-reader-toolbar').getByText(/%/)).toHaveText(manualScale);
    await expect(fitButton).toHaveAttribute('aria-pressed', 'false');
    await fitButton.click();
    await expect(fitButton).toHaveAttribute('aria-pressed', 'true');
    await assertPageFits(320);
    const portraitScale = Number((await page.locator('.ui-reader-toolbar').getByText(/%/).innerText()).replace('%', ''));

    // Page changes recalculate for the active page while retaining Fit width.
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(fitButton).toHaveAttribute('aria-pressed', 'true');
    await assertPageFits(320);
    const rotatedScale = Number((await page.locator('.ui-reader-toolbar').getByText(/%/).innerText()).replace('%', ''));
    expect(rotatedScale).toBeLessThan(portraitScale);
  });

  test('approved PDF entry restores a clamped page and serializes debounced position writes', async ({ page }) => {
    await setupAuthRoutes(page);
    const documentId = 'doc-reading-position';
    const moduleSlug = 'reading-module';
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');
    let openCount = 0;
    const writtenPages: number[] = [];
    const firstWrite = { release: undefined as (() => void) | undefined };

    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, (route) => route.fulfill({
      status: 200, json: { id: 'mod-1', community_id: 'irm', name: 'Reading Module', slug: moduleSlug },
    }));
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${documentId}`, (route) => route.fulfill({
      status: 200, json: {
        id: documentId, title: 'Reading Position PDF', module_id: 'mod-1', uploader_id: 'u-1',
        type: 'COURSE', source: 'OFFICIAL', status: 'APPROVED',
        created_at: '2026-03-01T10:00:00Z', updated_at: '2026-03-01T10:00:00Z',
      },
    }));
    await page.route(`**/api/v1/documents/${documentId}/view`, async (route) => {
      if (route.request().headers().range?.startsWith('bytes=0-0')) {
        await route.fulfill({ status: 206, headers: { 'content-type': 'application/pdf', 'content-range': `bytes 0-0/${pdfBuffer.length}` }, body: pdfBuffer.subarray(0, 1) });
      } else {
        await route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf' }, body: pdfBuffer });
      }
    });
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${documentId}/download`, (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf' }, body: pdfBuffer }));
    await page.route(`**/api/v1/communities/irm/documents/${documentId}/reading/open`, async (route) => {
      openCount += 1;
      await route.fulfill({ status: 200, json: { last_page: 99 }, headers: { 'cache-control': 'private, no-store' } });
    });
    await page.route(`**/api/v1/communities/irm/documents/${documentId}/reading/position`, async (route) => {
      const body = route.request().postDataJSON() as { page: number };
      writtenPages.push(body.page);
      if (writtenPages.length === 1) {
        await new Promise<void>((resolve) => { firstWrite.release = resolve; });
      }
      await route.fulfill({ status: 200, json: { last_page: body.page } });
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${documentId}`);
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible();
    expect(openCount).toBe(1);
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect.poll(() => writtenPages.length).toBe(1);

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await page.waitForTimeout(600);
    expect(writtenPages).toEqual([1]);
    firstWrite.release?.();
    await expect.poll(() => writtenPages.length).toBe(2);
    await expect.poll(() => writtenPages[1]).toBe(2);
    await page.getByRole('button', { name: 'Download Original' }).click();
    expect(openCount).toBe(1);
  });

  test('reading-state errors leave the PDF available and show restrained feedback', async ({ page }) => {
    await setupAuthRoutes(page);
    const documentId = 'doc-reading-error';
    const moduleSlug = 'reading-module';
    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, (route) => route.fulfill({ status: 200, json: { id: 'mod-1', community_id: 'irm', name: 'Reading Module', slug: moduleSlug } }));
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${documentId}`, (route) => route.fulfill({ status: 200, json: { id: documentId, title: 'Readable During API Error', module_id: 'mod-1', uploader_id: 'u-1', type: 'COURSE', source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-03-01T10:00:00Z', updated_at: '2026-03-01T10:00:00Z' } }));
    await page.route(`**/api/v1/documents/${documentId}/view`, async (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf' }, body: pdfBuffer }));
    await page.route(`**/api/v1/communities/irm/documents/${documentId}/reading/open`, (route) => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${documentId}`);
    await expect(page.locator('canvas[data-testid="pdf-canvas"]')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'could not be restored' })).toBeVisible();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
  });

  test('non-approved document details do not create reading opens', async ({ page }) => {
    await setupAuthRoutes(page);
    const documentId = 'doc-pending-no-open';
    const moduleSlug = 'reading-module';
    let openCount = 0;
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}`, (route) => route.fulfill({ status: 200, json: { id: 'mod-1', community_id: 'irm', name: 'Reading Module', slug: moduleSlug } }));
    await page.route(`**/api/v1/communities/irm/modules/${moduleSlug}/documents/${documentId}`, (route) => route.fulfill({ status: 200, json: { id: documentId, title: 'Pending Document', module_id: 'mod-1', uploader_id: 'u-1', type: 'COURSE', source: 'STUDENT', status: 'PENDING', created_at: '2026-03-01T10:00:00Z', updated_at: '2026-03-01T10:00:00Z' } }));
    await page.route(`**/api/v1/documents/${documentId}/view`, (route) => route.fulfill({ status: 403, headers: { 'content-type': 'application/pdf' } }));
    await page.route(`**/api/v1/communities/irm/documents/${documentId}/reading/open`, async (route) => {
      openCount += 1;
      await route.fulfill({ status: 200, json: { last_page: 1 } });
    });

    await page.goto(`/communities/irm/modules/${moduleSlug}/documents/${documentId}`);
    await expect(page.getByRole('heading', { name: 'Pending Document' })).toBeVisible();
    await expect(page.getByText('Please log in to view this document.')).toBeVisible();
    expect(openCount).toBe(0);
  });

});
