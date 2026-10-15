import { test, expect, type Page, type Route } from "@playwright/test";

const owner = {
  id: "11111111-1111-4111-8111-111111111111", username: "sara_elm",
  first_name: "Sara", family_name: "El Mansouri", email: "sara@example.test", avatar_url: null as string | null,
};
const other = { ...owner, id: "22222222-2222-4222-8222-222222222222", username: "amal" };
const version = "33333333-3333-4333-8333-333333333333";
const photoUrl = `/api/v1/users/${owner.id}/avatar/${version}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
type Account = typeof owner;

async function mockAccount(page: Page, initial = owner) {
  const state = {
    user: initial as Account | null, authStatus: 200, uploads: 0, removals: 0,
    upload: async (route: Route) => { state.user = { ...state.user!, avatar_url: photoUrl }; await route.fulfill({ status: 200, json: { avatar_url: photoUrl } }); },
    remove: async (route: Route) => { state.user = { ...state.user!, avatar_url: null }; await route.fulfill({ status: 200, json: { avatar_url: null } }); },
    patch: async (route: Route) => route.fulfill({ json: state.user }),
  };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/me/avatar" && route.request().method() === "PUT") { state.uploads++; return state.upload(route); }
    if (path === "/api/v1/auth/me/avatar" && route.request().method() === "DELETE") { state.removals++; return state.remove(route); }
    if (path === "/api/v1/auth/me" && route.request().method() === "PATCH") return state.patch(route);
    if (path === "/api/v1/auth/me") return state.authStatus !== 200
      ? route.fulfill({ status: state.authStatus, json: { detail: "Private auth failure" } }) : state.user
      ? route.fulfill({ json: state.user }) : route.fulfill({ status: 401, json: { detail: "Not authenticated" } });
    if (path === "/api/v1/communities/irm/membership/me") return route.fulfill({ json: { membership: null, capabilities: {} } });
    if (path.includes("/avatar/")) return route.fulfill({ status: 200, contentType: "image/png", body: png });
    return route.fulfill({ status: 404, json: { detail: "Unmocked" } });
  });
  return state;
}

async function choose(page: Page, data = png, mimeType = "image/png", name = "photo.png") {
  await page.locator('input[type="file"][accept="image/jpeg,image/png"]').setInputFiles({ name, mimeType, buffer: data });
}

test("local preview is unsaved, Cancel clears it, same file can be reselected, exact upload changes saved photo", async ({ page }) => {
  const state = await mockAccount(page);
  let body = "";
  let contentType = "";
  state.upload = async route => {
    body = route.request().postData() ?? "";
    contentType = route.request().headers()["content-type"] ?? "";
    state.user = { ...state.user!, avatar_url: photoUrl };
    await route.fulfill({ status: 200, json: { avatar_url: photoUrl } });
  };
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
  await expect(page.getByText("JPEG or PNG, maximum 2 MiB.", { exact: false })).toBeVisible();
  await choose(page);
  await expect(page.getByRole("heading", { name: "Local preview — not uploaded" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Selected photo preview, not uploaded" })).toBeVisible();
  await expect(page.getByRole("img", { name: "sara_elm's avatar" })).toContainText("SE");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Local preview — not uploaded" })).toHaveCount(0);
  await choose(page);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo uploaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
  await expect(page.getByRole("img", { name: "sara_elm's avatar" }).locator("img")).toBeVisible();
  const trigger = page.getByRole("button", { name: "Account options", exact: true });
  await expect(trigger.locator("img")).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-label", "Account options");
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(body).toContain('name="file"');
  expect(body).not.toContain('name="user_id"');
  expect(state.uploads).toBe(1);
});

test("existing photo removal uses confirmation and an empty DELETE body", async ({ page }) => {
  const state = await mockAccount(page, { ...owner, avatar_url: photoUrl });
  let body: string | null = "not checked";
  let contentType: string | undefined;
  state.remove = async route => {
    body = route.request().postData();
    contentType = route.request().headers()["content-type"];
    state.user = { ...state.user!, avatar_url: null };
    await route.fulfill({ status: 200, json: { avatar_url: null } });
  };
  await page.goto("/account");
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByRole("dialog", { name: "Remove your account photo?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove photo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByText("Photo removed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
  await expect(page.getByRole("img", { name: "sara_elm's avatar" })).toContainText("SE");
  await expect(page.getByRole("button", { name: "Account options", exact: true }).locator("img")).toHaveCount(0);
  expect(body).toBeNull();
  expect(contentType).toBeUndefined();
  expect(state.removals).toBe(1);
});

test("empty, oversized and unsupported files are rejected before upload", async ({ page }) => {
  const state = await mockAccount(page);
  await page.goto("/account");
  await choose(page, Buffer.alloc(0));
  await expect(page.getByText("Choose a nonempty JPEG or PNG image.")).toBeVisible();
  await choose(page, Buffer.alloc(2_097_153));
  await expect(page.getByText("Choose an image no larger than 2 MiB.")).toBeVisible();
  await choose(page, Buffer.from("GIF89a"), "image/gif", "photo.gif");
  await expect(page.getByText("Choose a JPEG or PNG image.")).toBeVisible();
  expect(state.uploads).toBe(0);
});

test("server image errors are safe and preserve the unsaved preview", async ({ page }) => {
  const state = await mockAccount(page);
  await page.goto("/account");
  await choose(page);
  state.upload = route => route.fulfill({ status: 422, json: { detail: "Private decoder path" } });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("The image could not be accepted.", { exact: false })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Private decoder path");
  await expect(page.getByRole("heading", { name: "Local preview — not uploaded" })).toBeVisible();
  state.upload = route => route.fulfill({ status: 413, json: { detail: "Private size" } });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("The image is too large.", { exact: false })).toBeVisible();
  state.upload = route => route.fulfill({ status: 403, json: { detail: "Private origin" } });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("This request was not authorized.", { exact: false })).toBeVisible();
});

test("confirmed upload remains confirmed when shared account refresh fails", async ({ page }) => {
  const state = await mockAccount(page);
  state.upload = async route => {
    state.user = { ...state.user!, avatar_url: photoUrl };
    state.authStatus = 503;
    await route.fulfill({ status: 200, json: { avatar_url: photoUrl } });
  };
  await page.goto("/account");
  await choose(page);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo uploaded, but your account could not be refreshed.", { exact: false })).toBeVisible();
  expect(state.uploads).toBe(1);
  state.authStatus = 200;
  await page.getByRole("button", { name: "Retry account check" }).click();
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
  expect(state.uploads).toBe(1);
});

test("expired session hides photo controls after a rejected upload", async ({ page }) => {
  const state = await mockAccount(page);
  state.upload = async route => { state.user = null; await route.fulfill({ status: 401, json: { detail: "Not authenticated" } }); };
  await page.goto("/account");
  await choose(page);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to view your account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add photo" })).toHaveCount(0);
});

test("pending upload is single; lost response uses read-only check before another change", async ({ page }) => {
  const state = await mockAccount(page);
  let finish!: () => void;
  state.upload = async route => { await new Promise<void>(resolve => { finish = resolve; }); await route.abort("failed"); };
  await page.goto("/account");
  await choose(page);
  const upload = page.getByRole("button", { name: /Upload photo|Uploading/ });
  await upload.click();
  await expect(upload).toBeDisabled();
  await upload.dispatchEvent("click");
  expect(state.uploads).toBe(1);
  finish();
  await expect(page.getByText("We couldn’t confirm whether the saved photo changed.", { exact: false })).toBeVisible();
  await expect(upload).toBeDisabled();
  state.user = { ...state.user!, avatar_url: photoUrl };
  await page.getByRole("button", { name: "Check saved photo" }).click();
  await expect(page.getByText("Your currently saved photo has changed.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
  expect(state.uploads).toBe(1);
});

test("avatar refresh keeps a dirty profile draft", async ({ page }) => {
  const state = await mockAccount(page);
  await page.goto("/account");
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("First name", { exact: true }).fill("Typed draft");
  await choose(page);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Typed draft");
  await expect(page.locator("dt", { hasText: "First name" }).locator("+ dd")).toHaveText(owner.first_name);
  expect(state.uploads).toBe(1);
});

test("a late profile response cannot restore the previous saved photo", async ({ page }) => {
  const state = await mockAccount(page);
  let releaseProfile!: () => void;
  state.patch = async route => {
    await new Promise<void>(resolve => { releaseProfile = resolve; });
    await route.fulfill({ json: { ...owner, first_name: "Changed", avatar_url: null } });
  };
  await page.goto("/account");
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("First name", { exact: true }).fill("Changed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await choose(page);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
  releaseProfile();
  await expect(page.locator("dt", { hasText: "First name" }).locator("+ dd")).toHaveText("Changed");
  await expect(page.getByRole("img", { name: "sara_elm's avatar" }).locator("img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Account options", exact: true }).locator("img")).toBeVisible();
  expect(state.uploads).toBe(1);
});

test("late avatar response after account switch cannot replace the new identity", async ({ page }) => {
  const state = await mockAccount(page);
  let finish!: () => void;
  state.upload = async route => { await new Promise<void>(resolve => { finish = resolve; }); await route.fulfill({ status: 200, json: { avatar_url: photoUrl } }).catch(() => {}); };
  state.patch = async route => { state.user = other; await route.fulfill({ json: other }); };
  await page.goto("/account");
  await choose(page);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("First name", { exact: true }).fill("Changed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("dt", { hasText: "Username" }).locator("+ dd")).toHaveText(other.username);
  finish();
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Photo uploaded.");
  const trigger = page.getByRole("button", { name: "Account options", exact: true });
  await expect(trigger.locator("img")).toHaveCount(0);
  await expect(trigger).toContainText("A");
  const profile = page.getByRole("complementary", { name: "Desktop Sidebar" }).locator('a[href="/account"]');
  await expect(profile).toContainText(other.username);
  await expect(profile).not.toContainText(owner.username);
});

test("header falls back on a failed avatar image and loads a new saved version", async ({ page }) => {
  const state = await mockAccount(page, { ...owner, avatar_url: photoUrl });
  const nextUrl = `/api/v1/users/${owner.id}/avatar/44444444-4444-4444-8444-444444444444`;
  await page.route(`**${photoUrl}`, route => route.fulfill({ status: 404, body: "" }));
  await page.goto("/account");
  const trigger = page.getByRole("button", { name: "Account options", exact: true });
  await expect(trigger).toContainText("SE");
  await expect(trigger.locator("img")).toHaveCount(0);
  const profile = page.getByRole("complementary", { name: "Desktop Sidebar" }).locator('a[href="/account"]');
  await expect(profile).toContainText("SE");
  await expect(profile.locator("img")).toHaveCount(0);
  state.upload = async route => {
    state.user = { ...state.user!, avatar_url: nextUrl };
    await route.fulfill({ status: 200, json: { avatar_url: nextUrl } });
  };
  await choose(page);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(trigger.locator("img")).toBeVisible();
  await expect(profile.locator("img")).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("region", { name: "Account options", exact: true }).locator('a[href="/account"] img')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("320px layout keeps controls and preview inside viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockAccount(page);
  await page.goto("/account");
  await choose(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const button of await page.locator("section[aria-labelledby='identity-heading'] button").all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
  test(`${theme} ${width}px avatar preview capture`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem("irm-theme", value), theme);
    await page.setViewportSize({ width, height: 844 });
    await mockAccount(page, { ...owner, avatar_url: photoUrl });
    await page.goto("/account");
    await choose(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const trigger = page.getByRole("button", { name: "Account options", exact: true });
    await expect(trigger.locator("img")).toBeVisible();
    await trigger.click();
    await expect(page.getByRole("region", { name: "Account options", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`avatar-header-${theme}-${width}.png`), fullPage: true });
  });
}
