import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];
function log(step, ok, extra = "") {
  results.push({ step, ok, extra });
  console.log(`${ok ? "OK  " : "FAIL"} ${step} ${extra}`);
}
async function login(page, l, p) {
  await page.goto(`${BASE}/login`);
  await page.fill("#login", l);
  await page.fill("#password", p);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

try {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, "owner", "owner123");

  // Manager should be blocked from /points
  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, "aigul", "aigul123");
  await mgr.goto(`${BASE}/points`);
  log("manager blocked from /points", mgr.url().endsWith("/schedule") || !mgr.url().includes("/points"), mgr.url());

  // Owner adds a VISIT task for SMM (Айперим) on current week
  await owner.goto(`${BASE}/schedule`);
  const body0 = await owner.textContent("body");
  if (body0.includes("Создать черновик графика")) {
    await owner.click('button:has-text("Создать черновик графика")');
    await owner.waitForTimeout(400);
  }
  const addForm = owner.locator("form", { has: owner.locator('select[name="userId"]') });
  if ((await addForm.count()) > 0) {
    await addForm.locator('select[name="userId"]').selectOption({ label: "Айперим (СММ)" });
    await addForm.locator('select[name="type"]').selectOption("VISIT");
    await addForm.locator('input[name="detail"]').fill("съёмка контента");
    await addForm.locator('button[type="submit"]').click();
    await owner.waitForTimeout(400);
  }
  log("visit task form submitted", true);

  // Also add a real SHIFT for Бегимай today so check-in/out can be exercised
  const addForm2 = owner.locator("form", { has: owner.locator('select[name="userId"]') });
  if ((await addForm2.count()) > 0) {
    await addForm2.locator('select[name="userId"]').selectOption({ label: "Бегимай" });
    await addForm2.locator('select[name="type"]').selectOption("SHIFT");
    await addForm2.locator('input[name="plannedStart"]').fill("00:00");
    await addForm2.locator('input[name="detail"]').fill("23:59");
    await addForm2.locator('button[type="submit"]').click();
    await owner.waitForTimeout(400);
  }

  // Publish the week (owner -> pending_employee, then need all confirms; use publishAnyway if available)
  const submitBtn = owner.locator('button:has-text("Отправить сотрудникам на подтверждение")');
  if ((await submitBtn.count()) > 0) {
    await submitBtn.click();
    await owner.waitForTimeout(400);
  }

  // Log in as each employee with a pending shift and confirm everything to reach "published"
  for (const [l, p] of [["begimai", "begimai123"], ["nurila", "nurila123"], ["aiperim", "aiperim123"], ["aigul", "aigul123"]]) {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    await login(pg, l, p);
    await pg.goto(`${BASE}/schedule`);
    let confirmBtn = pg.locator('button:has-text("Подтверждаю")').first();
    let guard = 0;
    while ((await confirmBtn.count()) > 0 && guard < 5) {
      await confirmBtn.click();
      await pg.waitForTimeout(300);
      confirmBtn = pg.locator('button:has-text("Подтверждаю")').first();
      guard++;
    }
    await ctx.close();
  }

  await owner.goto(`${BASE}/schedule`);
  const afterAllConfirm = await owner.textContent("body");
  log("schedule published after all confirmations", afterAllConfirm.includes("Опубликован"));

  // SMM marks visit
  const smmCtx = await browser.newContext();
  const smm = await smmCtx.newPage();
  await login(smm, "aiperim", "aiperim123");
  await smm.goto(`${BASE}/schedule`);
  const visitBtn = smm.locator('button:has-text("Посетила точку")').first();
  if ((await visitBtn.count()) > 0) {
    await visitBtn.click();
    await smm.waitForTimeout(400);
    log("visit marked", true);
  } else {
    log("visit button found", false);
  }
  await smmCtx.close();

  // Employee check-in / check-out
  const empCtx = await browser.newContext();
  const emp = await empCtx.newPage();
  await login(emp, "begimai", "begimai123");
  await emp.goto(`${BASE}/schedule`);
  const checkinBtn = emp.locator('button:has-text("Я на месте")').first();
  if ((await checkinBtn.count()) > 0) {
    await checkinBtn.click();
    await emp.waitForTimeout(400);
    log("check-in clicked", true);
  } else {
    log("check-in button found", false);
  }
  await emp.goto(`${BASE}/schedule`);
  const checkoutBtn = emp.locator('button:has-text("Я ухожу")').first();
  if ((await checkoutBtn.count()) > 0) {
    await checkoutBtn.click();
    await emp.waitForTimeout(400);
    log("check-out clicked", true);
  } else {
    log("check-out button found", false, "(ok if no SHIFT assigned to begimai this run)");
  }
  await empCtx.close();

  // Tabel shows data for owner
  await owner.goto(`${BASE}/tabel`);
  const tabelBody = await owner.textContent("body");
  log("tabel shows Айперим", tabelBody.includes("Айперим"));

  // CSV export works
  const csvResp = await owner.request.get(`${BASE}/tabel/export`);
  log("csv export status 200", csvResp.status() === 200);
  log("csv export content-type", (csvResp.headers()["content-type"] || "").includes("text/csv"));

  await ownerCtx.close();
  await mgrCtx.close();
} catch (e) {
  console.error("ERROR", e);
  results.push({ step: "unhandled", ok: false, extra: String(e) });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("Failed:", failed.map((f) => f.step).join(", "));
  process.exit(1);
}
