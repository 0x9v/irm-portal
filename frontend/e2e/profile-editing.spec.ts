import { test, expect, type Page, type Route } from "@playwright/test";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "sara_elm", first_name: "Sara", family_name: "El Mansouri",
  email: "sara@example.test", avatar_url: null as string | null,
};
const other = { ...base, id: "22222222-2222-4222-8222-222222222222", username: "amal", first_name: "Amal", email: "amal@example.test" };
type Account = typeof base;

async function accountMock(page: Page, member: "ACTIVE" | "BANNED" | null = null) {
  const state = { user: base as Account | null, member, authStatus: 200, patchCalls: 0,
    patch: async (route: Route) => {
      const changes = route.request().postDataJSON();
      state.user = { ...state.user!, ...changes };
      await route.fulfill({ json: state.user });
    },
  };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/me" && route.request().method() === "PATCH") {
      state.patchCalls++;
      return state.patch(route);
    }
    if (path === "/api/v1/auth/me") return state.authStatus === 200 && state.user
      ? route.fulfill({ json: state.user })
      : route.fulfill({ status: state.authStatus === 200 ? 401 : state.authStatus, json: { detail: "Private server text" } });
    if (path === "/api/v1/communities/irm/membership/me") return route.fulfill({ json: { membership: state.member ? { id: "m1", status: state.member, role: "MEMBER" } : null, capabilities: {} } });
    if (path === "/api/v1/auth/logout") { state.user = null; return route.fulfill({ json: { detail: "Successfully logged out" } }); }
    if (path.includes("/avatar/")) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 404, json: { detail: "Unmocked" } });
  });
  return state;
}

async function edit(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", { name: "Edit profile" })).toBeVisible();
}

test("opening and cancelling restores baseline with email read-only", async ({ page }) => {
  await accountMock(page);
  await edit(page);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue(base.username);
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue(base.first_name);
  await expect(page.getByLabel("Family name", { exact: true })).toHaveValue(base.family_name);
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await page.getByLabel("First name", { exact: true }).fill("Changed");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Edit profile" })).toHaveCount(0);
  await expect(page.locator("dd").last()).toHaveText(base.email);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue(base.first_name);
});

for (const member of [null, "BANNED"] as const) test(`${member ?? "no membership"} can save a partial Unicode profile`, async ({ page }) => {
  const state = await accountMock(page, member);
  let submitted: unknown;
  state.patch = async route => {
    submitted = route.request().postDataJSON();
    state.user = { ...state.user!, first_name: "آمينة" };
    await route.fulfill({ json: state.user });
  };
  await edit(page);
  await page.getByLabel("First name", { exact: true }).fill("  آمينة  ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile changes saved.")).toBeVisible();
  expect(submitted).toEqual({ first_name: "آمينة" });
  await expect(page.locator("dd", { hasText: "آمينة" })).toBeVisible();
  await expect(page.locator("dd").last()).toHaveText(base.email);
  expect(state.patchCalls).toBe(1);
});

test("Unicode limits, raw controls, conflict and field 422 keep the draft", async ({ page }) => {
  const state = await accountMock(page);
  await edit(page);
  const username = page.getByLabel("Username", { exact: true });
  await username.fill("😀😀");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#profile-username-error")).toContainText("3 to 50");
  expect(state.patchCalls).toBe(0);
  await username.fill("Valid\u202Ename");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#profile-username-error")).toContainText("control");
  await username.fill("😀😀😀");
  state.patch = route => route.fulfill({ status: 409, json: { detail: "Username is already taken." } });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#profile-username-error")).toHaveText("Username is already taken.");
  await expect(username).toHaveValue("😀😀😀");
  await expect(username).toHaveAttribute("aria-describedby", /profile-username-error/);
  state.patch = route => route.fulfill({ status: 422, json: { detail: [{ loc: ["body", "username"], type: "value_error", msg: "Private details" }] } });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#profile-username-error")).toContainText("3 to 50");
  await expect(page.locator("main")).not.toContainText("Private details");
});

test("pending Save cannot submit twice; confirmed save survives a failed identity refresh", async ({ page }) => {
  const state = await accountMock(page);
  let release!: () => void;
  state.patch = async route => {
    await new Promise<void>(resolve => { release = resolve; });
    state.user = { ...state.user!, username: "new_name" };
    state.authStatus = 503;
    await route.fulfill({ json: state.user });
  };
  await edit(page);
  await page.getByLabel("Username", { exact: true }).fill("new_name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(state.patchCalls).toBe(1);
  release();
  await expect(page.getByText("Profile changes were saved, but your account could not be refreshed.")).toBeVisible();
  expect(state.patchCalls).toBe(1);
  state.authStatus = 200;
  await page.getByRole("button", { name: "Retry account check" }).click();
  await expect(page.locator("dd").first()).toHaveText("new_name");
  await expect(page.getByText("Profile changes saved.")).toBeVisible();
});

test("lost PATCH response offers read-only reconciliation without replay", async ({ page }) => {
  const state = await accountMock(page);
  state.patch = async route => {
    state.user = { ...state.user!, family_name: "New family" };
    await route.abort("failed");
  };
  await edit(page);
  await page.getByLabel("Family name", { exact: true }).fill("New family");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/could not confirm whether your changes were saved/)).toBeVisible();
  await page.getByRole("button", { name: "Check saved profile" }).click();
  await expect(page.getByText(/current profile matches the values you submitted/)).toBeVisible();
  expect(state.patchCalls).toBe(1);
  await expect(page.getByLabel("Family name", { exact: true })).toHaveValue("New family");
});

test("logout and another account discard the old draft and late response", async ({ page }) => {
  const state = await accountMock(page);
  let release!: () => void;
  state.patch = async route => {
    await new Promise<void>(resolve => { release = resolve; });
    try { await route.fulfill({ json: { ...base, first_name: "Late result" } }); } catch { /* Aborted by account cleanup. */ }
  };
  await edit(page);
  await page.getByLabel("First name", { exact: true }).fill("Late result");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Account options", exact: true }).click();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  state.user = other;
  await page.goto("/account");
  await expect(page.locator("dd").first()).toHaveText(other.username);
  release();
  await expect(page.locator("main")).not.toContainText("Late result");
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
});

test("same-account refresh while dirty keeps typed values and updates saved baseline", async ({ page }) => {
  const state = await accountMock(page);
  state.patch = async route => {
    state.user = { ...state.user!, family_name: "Server family" };
    await route.fulfill({ status: 401, json: { detail: "Not authenticated" } });
  };
  await edit(page);
  await page.getByLabel("First name", { exact: true }).fill("Typed draft");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Typed draft");
  await expect(page.getByText(/saved profile changed while you were editing/)).toBeVisible();
  await expect(page.locator("dd", { hasText: "Server family" })).toBeVisible();
});

test("keyboard focus and 320px wrapping", async ({ page }) => {
  const state = await accountMock(page);
  state.user = { ...base, first_name: "Verylongname".repeat(10), email: `${"long".repeat(30)}@example.test` };
  await page.setViewportSize({ width: 320, height: 700 });
  await edit(page);
  const username = page.getByLabel("Username", { exact: true });
  await username.focus();
  await expect(username).toHaveCSS("outline-style", "solid");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const button of await page.getByRole("button", { name: /Save changes|Cancel/ }).all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
  test(`${theme} ${width}px edit form capture`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem("irm-theme", value), theme);
    await page.setViewportSize({ width, height: 844 });
    await accountMock(page);
    await edit(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`profile-edit-${theme}-${width}.png`), fullPage: true });
  });
}
