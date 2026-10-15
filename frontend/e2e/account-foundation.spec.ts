import { test, expect, type Page } from "@playwright/test";

const first = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "sara_elm",
  first_name: "Sara",
  family_name: "El Mansouri",
  email: "sara@example.test",
  avatar_url: null as string | null,
};
const second = { ...first, id: "22222222-2222-4222-8222-222222222222", username: "amal", first_name: "Amal", family_name: "Other", email: "amal@example.test" };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const avatar = (id: string, version: string) => `/api/v1/users/${id}/avatar/${version}`;

async function mockAccount(page: Page, options: {
  user?: typeof first | null;
  membership?: "ACTIVE" | "BANNED" | null;
  authStatus?: number;
  avatarStatus?: number;
} = {}) {
  const state = { user: options.user === undefined ? first : options.user, membership: options.membership ?? null,
    authStatus: options.authStatus ?? 200, avatarStatus: options.avatarStatus ?? 200, authCalls: 0, imageCalls: 0, logoutCalls: 0 };
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/me") {
      state.authCalls++;
      return state.authStatus === 200 && state.user
        ? route.fulfill({ json: state.user })
        : route.fulfill({ status: state.authStatus === 200 ? 401 : state.authStatus, json: { detail: "Private backend detail" } });
    }
    if (path === "/api/v1/communities/irm/membership/me") return route.fulfill({ json: { membership: state.membership ? { id: "member", status: state.membership, role: "MEMBER" } : null, capabilities: {} } });
    if (path === "/api/v1/auth/logout") {
      state.logoutCalls++;
      state.user = null;
      return route.fulfill({ status: 200, json: { detail: "Successfully logged out" } });
    }
    if (path.includes("/avatar/")) {
      state.imageCalls++;
      return state.avatarStatus === 200
        ? route.fulfill({ status: 200, contentType: "image/png", body: pixel })
        : route.fulfill({ status: state.avatarStatus, body: "" });
    }
    return route.fulfill({ status: 404, json: { detail: "Unmocked" } });
  });
  return state;
}

test("real read-only details and account navigation work without membership or with a ban", async ({ page }) => {
  const state = await mockAccount(page);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();
  for (const [term, value] of [["Username", "sara_elm"], ["First name", "Sara"], ["Family name", "El Mansouri"], ["Email", "sara@example.test"]]) {
    await expect(page.locator("dt", { hasText: term }).locator("+ dd")).toHaveText(value);
  }
  await expect(page.locator("main")).not.toContainText(first.id);
  await expect(page.locator("main")).not.toContainText("password");
  await expect(page.getByRole("img", { name: "sara_elm's avatar" })).toContainText("SE");
  const trigger = page.getByRole("button", { name: "Account options", exact: true });
  await trigger.click();
  const panel = page.getByRole("region", { name: "Account options", exact: true });
  await expect(panel.getByRole("link", { name: /sara_elm EtudSup account/ })).toHaveAttribute("href", "/account");
  await expect(panel.getByText("My account", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Use system appearance" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Support" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Logout" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.goto("/support");
  await page.getByRole("button", { name: "Account options", exact: true }).click();
  await page.getByRole("region", { name: "Account options", exact: true }).getByRole("link", { name: /sara_elm EtudSup account/ }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Profile details" })).toBeVisible();
  state.membership = "BANNED";
  await page.reload();
  await expect(page.getByRole("heading", { name: "Profile details" })).toBeVisible();
  await expect(page.locator("dd").last()).toHaveText(first.email);
});

test("checking, failed check with retry, and confirmed guest keep identity hidden", async ({ page }) => {
  let release!: () => void;
  let firstCall = true;
  await page.route("**/api/v1/auth/me", async route => {
    if (firstCall) {
      firstCall = false;
      await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ status: 503, json: { detail: "Private backend detail" } });
    }
    return route.fulfill({ json: first });
  });
  await page.route("**/api/v1/communities/irm/membership/me", route => route.fulfill({ json: { membership: null, capabilities: {} } }));
  await page.goto("/account");
  await expect(page.getByRole("status", { name: "Checking account" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(first.email);
  release();
  await expect(page.getByRole("button", { name: "Retry account check" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Private backend detail");
  await page.getByRole("button", { name: "Retry account check" }).click();
  await expect(page.locator("dd").last()).toHaveText(first.email);

  await page.unroute("**/api/v1/auth/me");
  const state = await mockAccount(page, { user: null });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to view your account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).last()).toHaveAttribute("href", "/login");
  await expect(page.locator("main")).not.toContainText(first.email);
  expect(state.authCalls).toBeGreaterThan(0);
});

test("avatar fallback handles missing image, version change, account change and logout", async ({ page }) => {
  const state = await mockAccount(page, { user: { ...first, avatar_url: avatar(first.id, "version-one") }, avatarStatus: 404 });
  await page.goto("/account");
  await expect(page.getByRole("img", { name: "sara_elm's avatar" })).toContainText("SE");
  await expect.poll(() => state.imageCalls).toBe(1);
  state.avatarStatus = 200;
  state.user = { ...first, avatar_url: avatar(first.id, "version-two") };
  await page.reload();
  await expect(page.getByRole("img", { name: "sara_elm's avatar" }).locator("img")).toBeVisible();
  expect(await page.getByRole("img", { name: "sara_elm's avatar" }).locator("img").getAttribute("src")).toMatch(/^blob:/);
  state.user = { ...second, avatar_url: null };
  await page.reload();
  await expect(page.getByRole("img", { name: "amal's avatar" })).toContainText("A");
  await expect(page.locator("main")).not.toContainText(first.email);
  await page.getByRole("button", { name: "Account options", exact: true }).click();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(state.logoutCalls).toBe(1);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Sign in to view your account" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(second.email);
});

test("optional legacy names and long details wrap at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const state = await mockAccount(page, { user: { ...first, first_name: "", family_name: "", avatar_url: null } });
  await page.goto("/account");
  await expect(page.locator("dd", { hasText: "Not provided" })).toHaveCount(2);
  state.user = { ...first, username: "username_with_a_very_long_unbroken_sequence".repeat(4), first_name: "LongFirstname".repeat(9), email: `${"longlocalpart".repeat(12)}@example.test` };
  await page.reload();
  await expect(page.locator("dd").last()).toHaveText(state.user.email);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const trigger = page.getByRole("button", { name: "Account options", exact: true });
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await trigger.focus();
  await expect(trigger).toHaveCSS("outline-style", "solid");
});

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
  test(`${theme} ${width}px account capture`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem("irm-theme", value), theme);
    await page.setViewportSize({ width, height: 844 });
    await mockAccount(page);
    await page.goto("/account");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { name: "Profile details" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`account-${theme}-${width}.png`), fullPage: true });
  });
}
