import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

const TWO_PAGE_PDF_B64 =
  'JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMgoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMik+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDIvS2lkc1s0IDAgUiA4IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDwvRm9udDw8L2hlbHYgNSAwIFI+Pj4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1JvdGF0ZSAwL1Jlc291cmNlcyAzIDAgUi9QYXJlbnQgMiAwIFIvQ29udGVudHNbNiAwIFJdPj4KZW5kb2JqCgo1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYS9FbmNvZGluZy9XaW5BbnNpRW5jb2Rpbmc+PgplbmRvYmoKCjYgMCBvYmoKPDwvTGVuZ3RoIDExMS9GaWx0ZXIvRmxhdGVEZWNvZGU+PgpzdHJlYW0KeNoVizEKQkEMRPucIjcwySYTP4jFBxs7YTuxEP8uFlrYeH4j0zzmzdCH1k7KUlEO4XTj/qbdc7y+rHvuk6+HECgSYdK03U18wUhPw4RnoKVjKR4mRfPvw3wzqd8DWh0wa70db/1Mp04X+gFKdBtKCmVuZHN0cmVhbQplbmRvYmoKCjcgMCBvYmoKPDwvRm9udDw8L2hlbHYgNSAwIFI+Pj4+CmVuZG9iagoKOCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1JvdGF0ZSAwL1Jlc291cmNlcyA3IDAgUi9QYXJlbnQgMiAwIFIvQ29udGVudHNbOSAwIFJdPj4KZW5kb2JqCgo5IDAgb2JqCjw8L0xlbmd0aCAxMDYvRmlsdGVyL0ZsYXRlRGVjb2RlPj4Kc3RyZWFtCnjaHYk7CsJgEAb7PcXewH1+a0AsAjZ2wnYhhUiChRY2nt8fmWpm6ENzk7IMlFO4wrjfdHhury/rkXvn5ZQCRSFN3PxuEooojLbBkQiTDOwlmODlJv8zagSyYtiER/l57Stdmm70A/GkGeIKZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDEwCjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA0MiAwMDAwMCBuIAowMDAwMDAwMTIwIDAwMDAwIG4gCjAwMDAwMDAxNzggMDAwMDAgbiAKMDAwMDAwMDIxOSAwMDAwMCBuIAowMDAwMDAwMzI2IDAwMDAwIG4gCjAwMDAwMDA0MTUgMDAwMDAgbiAKMDAwMDAwMDU5NSAwMDAwMCBuIAowMDAwMDAwNjM2IDAwMDAwIG4gCjAwMDAwMDA3NDMgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSAxMC9Sb290IDEgMCBSL0lEWzw3QTEzMkI2NzI1QzNBRDEyNkRDMzk3QzM5NkMzQjg2Mj48QjA3MzA5OEJDNjU0RjJEQzc3NDAyQjlCRTc5NEUzQ0Q+XT4+CnN0YXJ0eHJlZgo5MTgKJSVFT0YK';

function runPsql(query: string): string {
  const result = execSync(
    `psql -h 127.0.0.1 -p 5432 -U irm_test -d irm_integration_test -t -c "${query}"`,
    { encoding: 'utf-8' }
  );
  return result.trim();
}

function appointDelegate(email: string) {
  const userId = runPsql(`SELECT id FROM users WHERE email='${email}';`);
  if (!userId) {
    throw new Error(`User with email ${email} not found in test database`);
  }
  runPsql(`UPDATE memberships SET role='MEMBER' WHERE role='DELEGATE';`);
  const uniqueCne = `CNE_RDR_${Date.now().toString().slice(-4)}`;
  const backendDir = path.resolve(__dirname, '../../backend');
  execSync(
    `cd ${backendDir} && PYTHONPATH=. POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 .venv/bin/python scripts/appoint_delegate.py irm ${userId} --cne ${uniqueCne} --apply`,
    { encoding: 'utf-8' }
  );
}

test.describe('Real-Backend Integration: Authenticated PDF Reader & Authorization Boundaries', () => {
  test.beforeAll(() => {
    const backendDir = path.resolve(__dirname, '../../backend');
    execSync(
      `cd ${backendDir} && PYTHONPATH=. POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 .venv/bin/python scripts/seed.py`,
      { encoding: 'utf-8' }
    );
  });

  test('Real authenticated PDF upload, embedded reader rendering, navigation, and authorization boundaries', async ({ browser, request }) => {
    const testRun = Date.now().toString().slice(-6);
    const delegateEmail = `delegate_reader_${testRun}@example.com`;
    const delegateUsername = `delegate_reader_${testRun}`;
    const password = 'Password123!';

    // 1. Register and appoint Delegate
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/register');
    await page.fill('input[name=username]', delegateUsername);
    await page.fill('input[name=email]', delegateEmail);
    await page.fill('input[name=first_name]', 'Nadia');
    await page.fill('input[name=family_name]', 'Reader');
    await page.fill('input[name=password]', password);
    await page.click('button[type=submit]');
    await expect(page.getByText('Your account was created successfully!')).toBeVisible();

    appointDelegate(delegateEmail);

    // 2. Delegate logs in
    await page.goto('/login');
    await page.fill('input[name=email]', delegateEmail);
    await page.fill('input[name=password]', password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/account#community-membership');

    // Confirm active delegate role in Header
    await expect(page.locator('header').getByText('ACTIVE DELEGATE')).toBeVisible();

    // 3. Upload Approved Official Multi-page PDF
    await page.goto('/communities/irm/modules/advanced-c/upload');
    await expect(page.getByRole('heading', { name: 'Upload Document' })).toBeVisible();

    const pdfTitle = `Real PDF Document ${testRun}`;
    await page.fill('input#title', pdfTitle);

    // Select official source so it is published and approved immediately
    await page.getByLabel('Upload As').selectOption('OFFICIAL');

    const pdfBuffer = Buffer.from(TWO_PAGE_PDF_B64, 'base64');
    await page.setInputFiles('input#file', {
      name: `real_doc_${testRun}.pdf`,
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    await page.click('button[type=submit]');
    await expect(page.getByText('Upload Successful')).toBeVisible();
    await expect(page.getByText('Your official document has been published immediately.')).toBeVisible();

    // 4. Click "View Document" link to open approved document detail route
    const viewDocLink = page.getByRole('link', { name: 'View Document' });
    await expect(viewDocLink).toBeVisible();
    await viewDocLink.click();

    await page.waitForURL('**/communities/irm/modules/advanced-c/documents/*');
    const docUrl = page.url();
    const docId = docUrl.split('/').pop()!;
    expect(docId).toBeTruthy();

    // 5. Verify Automatic Embedded Rendering (No Mocking)
    await expect(page.getByRole('heading', { name: pdfTitle })).toBeVisible();
    await expect(page.getByText('PDF Document — 2 pages')).toBeVisible();

    // Verify Canvas is visible and contains non-empty pixel data from the real PDF
    const canvas = page.locator('canvas[data-testid="pdf-canvas"]');
    await expect(canvas).toBeVisible();
    const isCanvasNonEmpty = await canvas.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d');
      if (!ctx) return false;
      const imgData = ctx.getImageData(0, 0, Math.min(c.width, 100), Math.min(c.height, 100));
      return imgData.data.some((channel) => channel !== 0);
    });
    expect(isCanvasNonEmpty).toBe(true);

    // Verify Page 1 text from the real PDF is present in the text layer
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(page.locator('.textLayer')).toContainText('Page 1: Introduction to IRM Platform');

    // 6. Navigate between pages in the embedded reader
    const prevBtn = page.getByRole('button', { name: 'Previous page' });
    const nextBtn = page.getByRole('button', { name: 'Next page' });
    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    // Click Next
    await nextBtn.click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(nextBtn).toBeDisabled();
    await expect(prevBtn).toBeEnabled();
    await expect(page.locator('.textLayer')).toContainText('Page 2: Advanced Topics and Details');

    // Click Prev
    await prevBtn.click();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(page.locator('.textLayer')).toContainText('Page 1: Introduction to IRM Platform');

    // 7. Verify /view endpoint contract with real session
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session');
    expect(sessionCookie).toBeDefined();

    // Real full request
    const viewResponse = await request.get(`http://localhost:8000/api/v1/documents/${docId}/view`, {
      headers: { Cookie: `session=${sessionCookie!.value}` },
    });
    expect(viewResponse.status()).toBe(200);
    expect(viewResponse.headers()['content-type']).toBe('application/pdf');
    expect(viewResponse.headers()['content-disposition']).toContain('inline;');
    const returnedBytes = await viewResponse.body();
    expect(returnedBytes.length).toBe(pdfBuffer.length);

    // Real byte-range request
    const rangeResponse = await request.get(`http://localhost:8000/api/v1/documents/${docId}/view`, {
      headers: {
        Cookie: `session=${sessionCookie!.value}`,
        Range: 'bytes=0-0',
      },
    });
    expect(rangeResponse.status()).toBe(206);
    expect(rangeResponse.headers()['content-range']).toBe(`bytes 0-0/${pdfBuffer.length}`);
    expect((await rangeResponse.body()).length).toBe(1);

    // 8. Verify attachment download through /download
    const downloadResponse = await request.get(
      `http://localhost:8000/api/v1/communities/irm/modules/advanced-c/documents/${docId}/download`,
      { headers: { Cookie: `session=${sessionCookie!.value}` } }
    );
    expect(downloadResponse.status()).toBe(200);
    expect(downloadResponse.headers()['content-disposition']).toContain('attachment;');

    // 9. Authorization boundary: Guest (unauthenticated) cannot retrieve /view bytes
    const guestResponse = await request.get(`http://localhost:8000/api/v1/documents/${docId}/view`);
    expect(guestResponse.status()).toBe(401);

    // Guest visiting the page sees login guidance
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto(docUrl);
    await expect(guestPage.getByText('Unauthorized. Please log in to view this document.')).toBeVisible();
    await expect(guestPage.locator('canvas')).toHaveCount(0);
    await guestContext.close();

    // 10. Authorization boundary: PENDING student document cannot be viewed via /view
    await page.goto('/communities/irm/modules/advanced-c/upload');
    const studentTitle = `Student Pending Doc ${testRun}`;
    await page.fill('input#title', studentTitle);
    await page.getByLabel('Upload As').selectOption('STUDENT');
    await page.setInputFiles('input#file', {
      name: `pending_${testRun}.pdf`,
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });
    await page.click('button[type=submit]');
    await expect(page.getByText('Upload Successful')).toBeVisible();

    // Get the pending document ID from database
    const pendingDocId = runPsql(`SELECT id FROM documents WHERE title='${studentTitle}';`);
    expect(pendingDocId).toBeTruthy();

    // Attempting /view on PENDING document returns 404 (safe mask)
    const pendingViewRes = await request.get(`http://localhost:8000/api/v1/documents/${pendingDocId}/view`, {
      headers: { Cookie: `session=${sessionCookie!.value}` },
    });
    expect(pendingViewRes.status()).toBe(404);

    // 10b. Even after a YES vote is recorded, document is still PENDING so /view remains 404
    const delegateUserId = runPsql(`SELECT id FROM users WHERE email='${delegateEmail}';`);
    runPsql(`INSERT INTO document_votes (id, document_id, voter_id, vote, created_at, updated_at) VALUES (gen_random_uuid(), '${pendingDocId}', '${delegateUserId}', 'YES', NOW(), NOW());`);

    const voterPendingViewRes = await request.get(`http://localhost:8000/api/v1/documents/${pendingDocId}/view`, {
      headers: { Cookie: `session=${sessionCookie!.value}` },
    });
    expect(voterPendingViewRes.status()).toBe(404);

    // 10c. REJECTED document cannot be viewed via /view
    runPsql(`UPDATE documents SET status='REJECTED' WHERE id='${pendingDocId}';`);
    const rejectedViewRes = await request.get(`http://localhost:8000/api/v1/documents/${pendingDocId}/view`, {
      headers: { Cookie: `session=${sessionCookie!.value}` },
    });
    expect(rejectedViewRes.status()).toBe(404);

    // 11. Authorization boundary: Logout invalidates subsequent /view requests
    await page.locator('header').getByRole('button', { name: 'Logout' }).first().click();
    await page.waitForURL('**/login');

    const loggedOutViewRes = await request.get(`http://localhost:8000/api/v1/documents/${docId}/view`, {
      headers: { Cookie: `session=${sessionCookie!.value}` },
    });
    expect(loggedOutViewRes.status()).toBe(401);

    await context.close();
  });
});
