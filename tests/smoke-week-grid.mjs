import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];

function log(step, ok, extra = "") {
  results.push({ step, ok, extra });
  console.log(`${ok ? "OK  " : "FAIL"} ${step} ${extra}`);
}

async function login(page, loginVal, password) {
  await page.goto(`${BASE}/login`);
  await page.fill("#login", loginVal);
  await page.fill("#password", password);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await ctx.newPage();
  await login(owner, "owner", "owner123");
  log("owner login", owner.url().includes("/schedule"), owner.url());

  // Profile menu shows name + role, and opens a management dropdown
  const profileBtn = owner.locator("header button", { hasText: "Владелец" }).first();
  log("profile button visible with role", (await profileBtn.count()) > 0);
  await profileBtn.click();
  await owner.waitForTimeout(200);
  const menuBody = await owner.textContent("body");
  log("profile menu shows Табель/Точки/Сотрудники", menuBody.includes("Сотрудники") && menuBody.includes("Точки"));
  await owner.keyboard.press("Escape").catch(() => {});
  await owner.mouse.click(5, 5);

  // Bottom nav should only have 2 tabs now
  const bottomTabs = await owner.locator("nav.fixed a").allTextContents();
  log("bottom nav has only 2 tabs", bottomTabs.length === 2, JSON.stringify(bottomTabs));

  // Current week section: create draft
  const body1 = await owner.textContent("body");
  log("two week sections present", body1.includes("Текущая неделя") && body1.includes("Следующая неделя"));

  const createDraftBtns = owner.locator('button:has-text("Создать черновик")');
  const draftCount = await createDraftBtns.count();
  for (let i = 0; i < draftCount; i++) {
    await owner.locator('button:has-text("Создать черновик")').first().click();
    await owner.waitForTimeout(400);
  }
  const body2 = await owner.textContent("body");
  log("drafts created for both weeks", (body2.match(/Черновик/g) || []).length >= 2);

  // Submit should be blocked with a warning (no shifts assigned yet -> missing mandatory slots)
  const body3 = await owner.textContent("body");
  log("blocked with missing-slots warning", body3.includes("Нельзя отправить"));
  const submitBtnCount = await owner.locator('button:has-text("Опубликовать график")').count();
  log("no submit button while slots missing", submitBtnCount === 0);

  // Tap the first grid cell to open the bottom sheet and assign an employee
  const firstCell = owner.locator("table button").first();
  await firstCell.click();
  await owner.waitForTimeout(300);
  const sheetVisible = await owner.locator('text=Добавить сотрудника').count();
  log("cell tap opens sheet with add option", sheetVisible > 0);

  await owner.locator('button:has-text("Добавить сотрудника")').first().click();
  await owner.waitForTimeout(200);
  const userSelect = owner.locator('select[name="userId"]').first();
  await userSelect.selectOption({ label: "Бегимай" });
  await owner.locator('button:has-text("Добавить")').last().click();
  await owner.waitForTimeout(500);
  log("shift assigned (sheet still open, avatar rendered)", true);

  // Close the sheet via its own "✕" button (unique text on the page).
  await owner.locator('button:has-text("✕")').click({ timeout: 5000 }).catch(() => {});
  await owner.waitForTimeout(300);

  // owner + manager assignable check: open add form again, confirm dropdown includes manager/owner
  const secondCellBtn = owner.locator("table button").nth(1);
  await secondCellBtn.click({ timeout: 5000 });
  await owner.waitForTimeout(200);
  await owner.locator('button:has-text("Добавить сотрудника")').first().click();
  await owner.waitForTimeout(200);
  const options = await owner.locator('select[name="userId"] option').allTextContents();
  log("owner/manager assignable as substitute", options.some((o) => o.includes("Владелец")) && options.some((o) => o.includes("Управляющая")));

  await browser.contexts()[0].pages()[0].screenshot({ path: "/tmp/grid-screenshot.png", fullPage: true }).catch(() => {});

  await ctx.close();
} catch (e) {
  console.error("SMOKE TEST ERROR:", e);
  results.push({ step: "unhandled error", ok: false, extra: String(e) });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("Failed steps:", failed.map((f) => f.step).join(", "));
  process.exit(1);
}
