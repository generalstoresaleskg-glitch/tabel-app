import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];

function log(step, ok, extra = "") {
  results.push({ step, ok, extra });
  console.log(`${ok ? "OK  " : "FAIL"} ${step} ${extra}`);
}

async function login(page, login, password) {
  await page.goto(`${BASE}/login`);
  await page.fill("#login", login);
  await page.fill("#password", password);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

try {
  // --- Owner flow ---
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, "owner", "owner123");
  log("owner login", owner.url().includes("/schedule"), owner.url());

  await owner.goto(`${BASE}/points`);
  log("owner sees points page", (await owner.textContent("h1"))?.includes("Точки"));

  // Add a 4th point to verify CRUD works — scope to the "Добавить точку" form specifically
  const addPointForm = owner.locator("form", { has: owner.locator('button:has-text("Добавить")') }).last();
  await addPointForm.locator('input[name="name"]').fill("Тестовая точка");
  await addPointForm.locator('input[name="defaultOpenTime"]').fill("08:00");
  await addPointForm.locator('input[name="defaultCloseTime"]').fill("20:00");
  await addPointForm.locator('button[type="submit"]').click();
  await owner.waitForTimeout(500);
  // Point names render as <input defaultValue> (inline-editable rows), so check
  // input values, not textContent (which doesn't see input values).
  const pointNameInputs = await owner
    .locator('input[name="name"]')
    .evaluateAll((els) => els.map((el) => el.value));
  log("point created", pointNameInputs.includes("Тестовая точка"));

  await owner.goto(`${BASE}/employees`);
  log("owner sees employees page", (await owner.textContent("h1"))?.includes("Сотрудники"));

  // --- Create draft schedule for current week ---
  await owner.goto(`${BASE}/schedule`);
  const scheduleBody1 = await owner.textContent("body");
  if (scheduleBody1.includes("Создать черновик графика")) {
    await owner.click('button:has-text("Создать черновик графика")');
    await owner.waitForTimeout(500);
  }
  const afterDraft = await owner.textContent("body");
  log("schedule draft exists", afterDraft.includes("Черновик") || afterDraft.includes("график"));

  // Add a SHIFT for manager (Айгуль) and a VISIT for SMM (Айперим) using the add-shift form
  const selects = await owner.$$('form:has(button:has-text("Добавить")) select');
  // The add-shift form is identified by having select[name=userId]
  const addForm = owner.locator("form", { has: owner.locator('select[name="userId"]') });
  log("add-shift form present", (await addForm.count()) > 0);

  if ((await addForm.count()) > 0) {
    // explicitly assign to Бегимай (regular employee), not whichever option is first
    await addForm.locator('select[name="userId"]').selectOption({ label: "Бегимай" });
    await addForm.locator('select[name="type"]').selectOption("SHIFT");
    await addForm.locator('input[name="plannedStart"]').fill("10:00");
    await addForm.locator('input[name="detail"]').fill("19:00");
    await addForm.locator('button[type="submit"]').click();
    await owner.waitForTimeout(500);
    const afterAdd = await owner.textContent("body");
    log("shift added to grid", afterAdd.includes("10:00") || afterAdd.includes("ожидает подтверждения"));
  }

  // Submit for approval (owner -> goes straight to pending_employee)
  const submitBtn = owner.locator('button:has-text("Отправить сотрудникам на подтверждение")');
  if ((await submitBtn.count()) > 0) {
    await submitBtn.click();
    await owner.waitForTimeout(500);
    const afterSubmit = await owner.textContent("body");
    log("schedule moved to pending_employee", afterSubmit.includes("подтверждении у сотрудников"));
  } else {
    log("submit-for-approval button", false, "not found (maybe already past draft)");
  }

  // --- Employee flow: log in as Бегимай and confirm shift ---
  const empCtx = await browser.newContext();
  const emp = await empCtx.newPage();
  await login(emp, "begimai", "begimai123");
  log("employee login", emp.url().includes("/schedule"), emp.url());

  const empBody = await emp.textContent("body");
  log("employee sees schedule page", empBody.includes("График"));

  // If Бегимай has a pending confirmation, confirm it
  const confirmBtn = emp.locator('button:has-text("Подтверждаю")').first();
  if ((await confirmBtn.count()) > 0) {
    await confirmBtn.click();
    await emp.waitForTimeout(500);
    log("employee confirmed shift", true);
  } else {
    log("employee had a pending shift to confirm", false, "none found (ok if not assigned)");
  }

  // --- Tabel page for owner ---
  await owner.goto(`${BASE}/tabel`);
  const tabelBody = await owner.textContent("body");
  log("owner sees tabel page", tabelBody.includes("Табель"));

  await ownerCtx.close();
  await empCtx.close();
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
