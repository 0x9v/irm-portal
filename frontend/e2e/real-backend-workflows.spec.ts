import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

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
  // Demote previous test delegate to allow appointing new test delegate
  runPsql(`UPDATE memberships SET role='MEMBER' WHERE role='DELEGATE';`);
  const uniqueCne = `CNE_DEL_${Date.now().toString().slice(-4)}`;
  const backendDir = path.resolve(__dirname, '../../backend');
  execSync(
    `cd ${backendDir} && PYTHONPATH=. POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 .venv/bin/python scripts/appoint_delegate.py irm ${userId} --cne ${uniqueCne} --apply`,
    { encoding: 'utf-8' }
  );
}

test.describe('Real-Backend Integration: End-to-End Workflows with Isolated DB', () => {
  test.beforeAll(() => {
    const backendDir = path.resolve(__dirname, '../../backend');
    execSync(
      `cd ${backendDir} && PYTHONPATH=. POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 .venv/bin/python scripts/seed.py`,
      { encoding: 'utf-8' }
    );
  });

  test('Complete lifecycle: Register -> Session Cookie (HttpOnly) -> Request Membership -> Withdraw -> Appoint Delegate -> Approve -> Browse & Upload -> Vote -> Logout', async ({ browser }) => {
    // Unique test run IDs to prevent collision
    const testRun = Date.now().toString().slice(-6);
    const applicantEmail = `applicant_${testRun}@example.com`;
    const applicantUsername = `applicant_${testRun}`;
    const delegateEmail = `delegate_${testRun}@example.com`;
    const delegateUsername = `delegate_${testRun}`;
    const password = 'Password123!';

    // Context 1: Applicant
    const applicantContext = await browser.newContext();
    const pageApplicant = await applicantContext.newPage();

    // 1. Register Applicant
    await pageApplicant.goto('/register');
    await pageApplicant.fill('input[name=username]', applicantUsername);
    await pageApplicant.fill('input[name=email]', applicantEmail);
    await pageApplicant.fill('input[name=first_name]', 'Youssef');
    await pageApplicant.fill('input[name=family_name]', 'Tazi');
    await pageApplicant.fill('input[name=password]', password);
    await pageApplicant.click('button[type=submit]');

    await expect(pageApplicant.getByText('Your account was created successfully!')).toBeVisible();

    // 2. Login Applicant and verify HttpOnly session cookie
    await pageApplicant.click('text=Continue to Log In');
    await pageApplicant.waitForURL('**/login');
    await pageApplicant.fill('input[name=email]', applicantEmail);
    await pageApplicant.fill('input[name=password]', password);
    await pageApplicant.click('button[type=submit]');

    await pageApplicant.waitForURL('**/account#community-membership');

    // Confirm real HttpOnly cookie was set
    const cookies = await applicantContext.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session');
    expect(sessionCookie, 'Session cookie session must be present').toBeDefined();
    expect(sessionCookie!.httpOnly, 'Session cookie must be HttpOnly').toBe(true);

    // Confirm authenticated header shows applicant username
    const applicantHeader = pageApplicant.locator('header');
    await expect(applicantHeader.getByText(applicantUsername)).toBeVisible();
    await expect(pageApplicant.getByRole('heading', { name: 'IRM Membership' })).toBeVisible();

    // 3. Request Membership with CNE
    const cneApplicant = `CNE${testRun}`;
    await pageApplicant.fill('input[name=cne]', cneApplicant);
    await pageApplicant.click('button[type=submit]');

    await expect(pageApplicant.getByText('Membership request submitted successfully.')).toBeVisible();
    await expect(pageApplicant.getByText('Current Membership')).toBeVisible();
    await expect(pageApplicant.locator('main').getByText('PENDING', { exact: true })).toBeVisible();

    // 4. Test Pending Request Withdrawal
    const cancelBtn = pageApplicant.getByRole('button', { name: /Cancel pending request/i });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    const confirmCancelBtn = pageApplicant.getByRole('button', { name: /Confirm Cancellation/i });
    await expect(confirmCancelBtn).toBeVisible();
    await confirmCancelBtn.click();

    await expect(pageApplicant.getByText('Pending membership request canceled successfully.')).toBeVisible();
    // User remains logged in and form returns
    await expect(applicantHeader.getByText(applicantUsername)).toBeVisible();
    await expect(pageApplicant.getByLabel('Student CNE')).toBeVisible();

    // Re-apply for membership
    await pageApplicant.fill('input[name=cne]', cneApplicant);
    await pageApplicant.click('button[type=submit]');
    await expect(pageApplicant.locator('main').getByText('PENDING', { exact: true })).toBeVisible();

    // 5. Register and Appoint Delegate in real backend
    const delegateContext = await browser.newContext();
    const pageDelegate = await delegateContext.newPage();

    await pageDelegate.goto('/register');
    await pageDelegate.fill('input[name=username]', delegateUsername);
    await pageDelegate.fill('input[name=email]', delegateEmail);
    await pageDelegate.fill('input[name=first_name]', 'Imane');
    await pageDelegate.fill('input[name=family_name]', 'Delegate');
    await pageDelegate.fill('input[name=password]', password);
    await pageDelegate.click('button[type=submit]');
    await expect(pageDelegate.getByText('Your account was created successfully!')).toBeVisible();

    // Appoint as Delegate via backend provisioning script
    appointDelegate(delegateEmail);

    // Delegate logs in
    await pageDelegate.goto('/login');
    await pageDelegate.fill('input[name=email]', delegateEmail);
    await pageDelegate.fill('input[name=password]', password);
    await pageDelegate.click('button[type=submit]');
    await pageDelegate.waitForURL('**/account#community-membership');

    const delegateHeader = pageDelegate.locator('header');
    await expect(delegateHeader.getByText(delegateUsername)).toBeVisible();
    await expect(delegateHeader.getByText('ACTIVE DELEGATE')).toBeVisible();

    // 6. Delegate navigates to Review Applications and approves applicant
    await pageDelegate.getByRole('link', { name: /Review Pending Applications/i }).click();
    await pageDelegate.waitForURL('**/communities/irm/membership/review');

    await expect(pageDelegate.getByText(applicantUsername)).toBeVisible();
    await expect(pageDelegate.getByText(cneApplicant)).toBeVisible();

    const applicantCard = pageDelegate.locator('div.bg-gray-50', { hasText: cneApplicant });
    const approveButton = applicantCard.getByRole('button', { name: 'Approve' });
    await approveButton.click();

    await expect(pageDelegate.getByText('Application was successfully approved')).toBeVisible();

    // 7. Applicant refreshes and confirms ACTIVE status
    await pageApplicant.reload();
    await expect(applicantHeader.getByText('ACTIVE MEMBER')).toBeVisible();
    await expect(pageApplicant.getByText('You are an active member.')).toBeVisible();

    // 8. Active member uploads a student document to an existing module
    await pageApplicant.getByRole('link', { name: /Explore Modules/i }).click();
    await pageApplicant.waitForURL('**/communities/irm/modules');

    // Click on first module
    await pageApplicant.getByRole('link', { name: /Open Module/i }).first().click();
    await pageApplicant.waitForURL('**/communities/irm/modules/*');

    const uploadLink = pageApplicant.getByRole('link', { name: 'Upload Document' });
    await expect(uploadLink).toBeVisible();
    await uploadLink.click();

    await pageApplicant.waitForURL('**/upload');
    await pageApplicant.fill('input#title', `Test Document ${testRun}`);

    // Create a minimal 1x1 PNG file in memory to upload
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    await pageApplicant.setInputFiles('input#file', {
      name: `sample_${testRun}.png`,
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    await pageApplicant.click('button[type=submit]');
    await expect(pageApplicant.getByText('Upload Successful')).toBeVisible();
    await expect(pageApplicant.getByText('Your document has been submitted for community voting.')).toBeVisible();

    // 9. Delegate views pending queue and votes
    await pageDelegate.goto('/communities/irm/documents/pending');
    await expect(pageDelegate.getByText(`Test Document ${testRun}`)).toBeVisible();

    // Load preview and cast vote
    const docCard = pageDelegate.locator('div.rounded-xl', { has: pageDelegate.getByRole('heading', { name: `Test Document ${testRun}` }) });
    await docCard.getByRole('button', { name: 'Load Preview' }).click();
    const yesVoteBtn = docCard.getByRole('button', { name: /YES — relevant/i });
    await expect(yesVoteBtn).toBeVisible();

    // Cast vote
    await yesVoteBtn.click();
    await expect(pageDelegate.getByText(`Vote successfully recorded for "Test Document ${testRun}"`)).toBeVisible();

    // 10. Announcements flow: Delegate creates -> Active member views on Home -> Card -> Detail -> Guest denied
    await pageDelegate.goto('/communities/irm/announcements');
    await expect(pageDelegate.getByRole('heading', { name: 'Post Announcement' })).toBeVisible();
    await pageDelegate.fill('#announcement-title', `Real Notice ${testRun}`);
    await pageDelegate.fill('#announcement-content', `Official notice body text for test run ${testRun}.`);
    await pageDelegate.click('button[type=submit]');
    await expect(pageDelegate.getByText('Announcement created successfully.')).toBeVisible();
    await expect(pageDelegate.getByText(`Real Notice ${testRun}`)).toBeVisible();

    // Active member visits Home and sees latest announcement
    await pageApplicant.goto('/');
    await expect(pageApplicant.getByRole('heading', { name: 'Latest Announcements' })).toBeVisible();
    const annCard = pageApplicant.getByRole('link', { name: new RegExp(`Real Notice ${testRun}`) });
    await expect(annCard).toBeVisible();

    // Navigate Home -> Card -> Detail
    await annCard.click();
    await pageApplicant.waitForURL('**/communities/irm/announcements/*');
    await expect(pageApplicant.getByRole('heading', { level: 1, name: `Real Notice ${testRun}` })).toBeVisible();
    await expect(pageApplicant.getByText(`By @${delegateUsername}`)).toBeVisible();
    await expect(pageApplicant.getByText(`Official notice body text for test run ${testRun}.`)).toBeVisible();

    // Return to All Announcements
    await pageApplicant.click('text=Back to Announcements');
    await pageApplicant.waitForURL('**/communities/irm/announcements');
    await expect(pageApplicant.getByText(`Real Notice ${testRun}`)).toBeVisible();

    // Guest context is denied access
    const guestContext = await browser.newContext();
    const pageGuest = await guestContext.newPage();
    await pageGuest.goto('/communities/irm/announcements');
    await expect(pageGuest.getByText('Authentication Needed')).toBeVisible();
    await guestContext.close();

    // 11. Logout and verify invalidation
    await delegateHeader.getByRole('button', { name: 'Logout' }).first().click();
    await pageDelegate.waitForURL('**/login');
    await expect(delegateHeader.getByRole('link', { name: 'Log In' })).toBeVisible();

    // Try accessing protected pending documents page directly
    await pageDelegate.goto('/communities/irm/documents/pending');
    await expect(pageDelegate.getByText('Authentication Needed')).toBeVisible();

    // Cleanup contexts
    await applicantContext.close();
    await delegateContext.close();
  });
});
