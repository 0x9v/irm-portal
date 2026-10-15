import { test, expect, type Page, type Route } from "@playwright/test";

const owner = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "sara_elm", first_name: "Sara", family_name: "El Mansouri",
  email: "sara@example.test", avatar_url: null,
};
const other = { ...owner, id: "22222222-2222-4222-8222-222222222222", username: "amal", first_name: "Amal" };
type Account = typeof owner;

async function mockAccount(page: Page, membership: "ACTIVE" | "BANNED" | null = null) {
  const state = {
    user: owner as Account | null,
    membership,
    passwordCalls: 0,
    logoutCalls: 0,
    password: async (route: Route) => {
      state.user = null;
      await route.fulfill({ status: 204, body: "" });
    },
    patch: async (route: Route) => route.fulfill({ json: state.user }),
  };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/me/password") { state.passwordCalls++; return state.password(route); }
    if (path === "/api/v1/auth/me" && route.request().method() === "PATCH") return state.patch(route);
    if (path === "/api/v1/auth/me") return state.user
      ? route.fulfill({ json: state.user }) : route.fulfill({ status: 401, json: { detail: "Not authenticated" } });
    if (path === "/api/v1/communities/irm/membership/me") return route.fulfill({ json: {
      membership: state.membership ? { id: "member", status: state.membership, role: "MEMBER" } : null,
      capabilities: {},
    } });
    if (path === "/api/v1/auth/logout") { state.logoutCalls++; return route.fulfill({ status: 200, body: "" }); }
    return route.fulfill({ status: 404, json: { detail: "Unmocked" } });
  });
  return state;
}

async function openForm(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Changing your password signs you out on all devices.", { exact: false })).toBeVisible();
}

async function fillValid(page: Page, current = "old-password", next = "new-password") {
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
}

test("inline form, autocomplete, show/hide, keyboard focus and Cancel clear secrets", async ({ page }) => {
  await mockAccount(page);
  await openForm(page);
  await expect(page.getByLabel("Current password")).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByLabel("Confirm new password")).toHaveAttribute("autocomplete", "new-password");
  await fillValid(page);
  const show = page.getByRole("button", { name: "Show passwords" });
  await show.focus();
  await expect(show).toBeFocused();
  await expect(show).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Current password")).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide passwords" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByLabel("Current password")).toHaveValue("");
});

for (const membership of [null, "BANNED"] as const) test(`${membership ?? "no membership"}: exact Unicode/whitespace payload, 204 and one-time sign-in notice`, async ({ page }) => {
  const state = await mockAccount(page, membership);
  let payload: unknown;
  state.password = async route => {
    payload = route.request().postDataJSON();
    expect(route.request().headers()["content-type"]).toContain("application/json");
    state.user = null;
    await route.fulfill({ status: 204, body: "" });
  };
  await openForm(page);
  await fillValid(page, " old pass ", " 😀😀😀😀😀😀😀😀 ");
  await page.getByRole("button", { name: "Change password" }).last().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Password changed. Sign in with your new password.")).toBeVisible();
  await expect(page.getByLabel("Email Address")).toBeVisible();
  await expect(page.getByRole("button", { name: "Account options", exact: true })).toHaveCount(0);
  expect(payload).toEqual({ current_password: " old pass ", new_password: " 😀😀😀😀😀😀😀😀 " });
  expect(state.passwordCalls).toBe(1);
  expect(state.logoutCalls).toBe(0);
  await page.goto("/support");
  await page.goto("/login");
  await expect(page.getByText("Password changed. Sign in with your new password.")).toHaveCount(0);
});

test("local code-point, difference and confirmation validation avoid requests", async ({ page }) => {
  const state = await mockAccount(page);
  await openForm(page);
  const submit = page.getByRole("button", { name: "Change password" }).last();
  await submit.click();
  await expect(page.locator("#security-current_password-error")).toContainText("current password");
  await page.getByLabel("Current password").fill("samepass");
  await page.getByLabel("New password", { exact: true }).fill("😀😀😀😀😀😀😀");
  await page.getByLabel("Confirm new password").fill("different");
  await submit.click();
  await expect(page.locator("#security-new_password-error")).toContainText("at least 8");
  await expect(page.locator("#security-confirm_password-error")).toContainText("do not match");
  await fillValid(page, "samepass", "samepass");
  await submit.click();
  await expect(page.locator("#security-new_password-error")).toContainText("different");
  expect(state.passwordCalls).toBe(0);
});

test("400, password_unchanged 422, 403 and 413 give safe inline feedback", async ({ page }) => {
  const state = await mockAccount(page);
  await openForm(page);
  await fillValid(page);
  const submit = page.getByRole("button", { name: "Change password" }).last();
  state.password = route => route.fulfill({ status: 400, json: { detail: "Current password is incorrect." } });
  await submit.click();
  await expect(page.locator("#security-current_password-error")).toContainText("incorrect");
  await expect(page.getByLabel("Current password")).toHaveValue("old-password");
  state.password = route => route.fulfill({ status: 422, json: { detail: [{ loc: ["body", "new_password"], type: "password_unchanged", msg: "Private server text" }] } });
  await submit.click();
  await expect(page.locator("#security-new_password-error")).toContainText("different");
  await expect(page.locator("main")).not.toContainText("Private server text");
  state.password = route => route.fulfill({ status: 403, json: { detail: "Private origin detail" } });
  await submit.click();
  await expect(page.getByText("This request was not authorized.", { exact: false })).toBeVisible();
  state.password = route => route.fulfill({ status: 413, json: { detail: "Private size detail" } });
  await submit.click();
  await expect(page.getByText("The request is too large.", { exact: false })).toBeVisible();
  expect(state.passwordCalls).toBe(4);
});

test("pending submit is single and uncertain network response offers sign-in without replay", async ({ page }) => {
  const state = await mockAccount(page);
  let finish!: () => void;
  state.password = async route => { await new Promise<void>(resolve => { finish = resolve; }); await route.abort("failed"); };
  await openForm(page);
  await fillValid(page);
  const submit = page.getByRole("button", { name: "Change password" }).last();
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await submit.dispatchEvent("click");
  expect(state.passwordCalls).toBe(1);
  finish();
  await expect(page.getByText("We couldn’t confirm the result.", { exact: false })).toBeVisible();
  expect(state.passwordCalls).toBe(1);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email Address")).toBeVisible();
  await expect(page.getByText("Password changed.", { exact: false })).toHaveCount(0);
  expect(state.logoutCalls).toBe(0);
});

test("an unexpected successful status is not treated as confirmed password change", async ({ page }) => {
  const state = await mockAccount(page);
  state.password = route => route.fulfill({ status: 200, json: { detail: "Unexpected" } });
  await openForm(page);
  await fillValid(page);
  await page.getByRole("button", { name: "Change password" }).last().click();
  await expect(page.getByText("We couldn’t confirm the result.", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  expect(state.logoutCalls).toBe(0);
});

test("401 clears authenticated state without a success claim", async ({ page }) => {
  const state = await mockAccount(page);
  state.password = route => route.fulfill({ status: 401, json: { detail: "Not authenticated" } });
  await openForm(page);
  await fillValid(page);
  await page.getByRole("button", { name: "Change password" }).last().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email Address")).toBeVisible();
  await expect(page.getByText("Password changed.", { exact: false })).toHaveCount(0);
  expect(state.logoutCalls).toBe(0);
});

test("late password completion after account switch cannot redirect or clear the new account", async ({ page }) => {
  const state = await mockAccount(page);
  let finish!: () => void;
  state.password = async route => { await new Promise<void>(resolve => { finish = resolve; }); await route.fulfill({ status: 204, body: "" }).catch(() => {}); };
  state.patch = async route => { state.user = other; await route.fulfill({ json: other }); };
  await openForm(page);
  await fillValid(page);
  await page.getByRole("button", { name: "Change password" }).last().click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("First name", { exact: true }).fill("Changed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("dt", { hasText: "Username" }).locator("+ dd")).toHaveText(other.username);
  finish();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  expect(state.logoutCalls).toBe(0);
});

test("320px form has no horizontal overflow and 44px controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockAccount(page);
  await openForm(page);
  await page.getByLabel("Current password").focus();
  await expect(page.getByLabel("Current password")).toHaveCSS("outline-style", "solid");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const button of await page.locator("section[aria-labelledby='security-heading'] button").all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
  test(`${theme} ${width}px Security form capture`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem("irm-theme", value), theme);
    await page.setViewportSize({ width, height: 844 });
    await mockAccount(page);
    await openForm(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`password-security-${theme}-${width}.png`), fullPage: true });
  });
}
