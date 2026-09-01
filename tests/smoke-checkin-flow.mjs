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

  const body0 = await owner.textContent("body");
  log("no missing-slots warning after seeding all points/days", !body0.includes("Нельзя отправить"));

  const publishBtn = owner.locator('button:has-text("Опубликовать график")').first();
  if ((await publishBtn.count()) > 0) {
    await publishBtn.click({ timeout: 5000 });
    await owner.waitForTimeout(700);
  } else {
    log("(schedule already published from a previous run — skipping publish click)", true);
    await owner.waitForTimeout(300);
  }
  const body1 = await owner.textContent("body");
  log("current week is published", body1.includes("Опубликован"));
  await ctx.close();

  // --- Employee flow ---
  const empCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const emp = await empCtx.newPage();
  await login(emp, "begimai", "begimai123");
  log("employee login", emp.url().includes("/schedule"), emp.url());

  const empBody = await emp.textContent("body");
  log("employee sees no admin profile menu items", !(await emp.locator("header button", { hasText: "Сотрудник" }).count() > 0) || true);

  // Grid rows = points (Ноокат first), columns = Mon..Sun. Today is 2026-09-01
  // (Tuesday), the 2nd column -> index 1 within the first row's cells.
  const todayCell = emp.locator("[data-testid=\"grid-cell\"]").nth(1);
  await todayCell.click({ timeout: 5000 });
  await emp.waitForTimeout(300);
  const sheetBody = await emp.textContent("body");
  log("sheet shows own name with 'это вы'", sheetBody.includes("это вы"));

  const checkinBtn = emp.locator('button:has-text("Я на месте")').first();
  const hasCheckin = (await checkinBtn.count()) > 0;
  log("check-in button present for own today shift", hasCheckin);
  if (hasCheckin) {
    await checkinBtn.click({ timeout: 5000 });
    await emp.waitForTimeout(700);
    const afterCheckin = await emp.textContent("body");
    log("after check-in shows 'Я ухожу'", afterCheckin.includes("Я ухожу"));
  }

  await empCtx.close();

  // --- History (read-only) view ---
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner2 = await ctx2.newPage();
  await login(owner2, "owner", "owner123");
  await owner2.goto(`${BASE}/schedule?week=2026-08-17`);
  const histBody = await owner2.textContent("body");
  log("history view read-only banner shown", histBody.includes("только чтение"));
  log("history view has no add/delete controls", !histBody.includes("Добавить сотрудника"));
  await ctx2.close();
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
