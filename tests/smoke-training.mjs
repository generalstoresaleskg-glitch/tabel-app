import { chromium } from "playwright";

const BASE = "http://localhost:3100";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="login"]', "begimai");
  await page.fill('input[name="password"]', "begimai123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/schedule|\/$/, { timeout: 10000 });
  log("logged in as employee begimai");

  // mobile bottom nav should show Обучение between График and Табель
  const navText = await page.locator("nav").last().innerText();
  log(`bottom nav text: ${navText.replace(/\n/g, " | ")}`);
  if (!navText.includes("Обучение")) throw new Error("Обучение missing from bottom nav");

  await page.locator('nav.fixed a[href="/training"]').click();
  await page.waitForURL(/\/training$/);
  log("navigated to /training via bottom nav tap");

  const moduleCount = await page.locator('a[href^="/training/m"]').count();
  log(`module cards found: ${moduleCount}`);
  if (moduleCount < 9) throw new Error(`expected 9 module cards, found ${moduleCount}`);

  await page.click('a[href="/training/m1"]');
  await page.waitForURL(/\/training\/m1$/);
  const lessonCount = await page.locator('a[href^="/training/m1/"]:not([href*="quiz"])').count();
  log(`lessons in module 1: ${lessonCount}`);
  if (lessonCount !== 6) throw new Error(`expected 6 lessons, found ${lessonCount}`);

  await page.click('a[href="/training/m1/m1-l1"]');
  await page.waitForURL(/\/training\/m1\/m1-l1$/);
  await page.waitForSelector("img");
  const imgCount = await page.locator("img").count();
  log(`images rendered on lesson page: ${imgCount}`);
  if (imgCount < 5) throw new Error("expected multiple page images on lesson viewer");

  // check first image actually loads (not broken)
  const firstImgOk = await page.evaluate(() => {
    const img = document.querySelector("img");
    return img && img.complete && img.naturalWidth > 0;
  });
  log(`first image loaded naturally: ${firstImgOk}`);

  // walk through all 6 lessons via "Урок пройден" button to reach quiz.
  // Wait for each specific next URL (not just networkidle) to avoid racing
  // Next's client transition — a real user reading pages wouldn't hit this.
  const lessonSlugs = ["m1-l1", "m1-l2", "m1-l3", "m1-l4", "m1-l5", "m1-l6"];
  for (let i = 0; i < lessonSlugs.length; i++) {
    await page.waitForURL(new RegExp(`/training/m1/${lessonSlugs[i]}$`), { timeout: 10000 });
    await page.waitForSelector('button[type="submit"]:has-text("Урок пройден")');
    const nextUrlPattern =
      i === lessonSlugs.length - 1
        ? /\/training\/m1\/quiz$/
        : new RegExp(`/training/m1/${lessonSlugs[i + 1]}$`);
    await page.click('button[type="submit"]');
    await page.waitForURL(nextUrlPattern, { timeout: 10000 });
    log(`completed ${lessonSlugs[i]} -> ${page.url()}`);
  }
  log("reached quiz page after completing all lessons");

  const questionCount = await page.locator('input[type="radio"]').count();
  log(`radio options rendered: ${questionCount}`);

  // answer everything with the first option for each question (may fail quiz, that's fine, just testing plumbing)
  const questionBlocks = await page.locator("form .card-pad").all();
  for (const block of questionBlocks) {
    await block.locator('input[type="radio"]').first().check();
  }
  await page.click('button:has-text("Завершить тест")');
  await page.waitForURL(/\/training\/m1\/quiz\/result\//, { timeout: 10000 });
  const resultText = await page.locator("h1").innerText();
  log(`quiz result heading: ${resultText}`);

  // check course list now shows lessons done 6/6
  await page.goto(`${BASE}/training/m1`);
  const subtitle = await page.locator(".page-subtitle").first().innerText();
  log(`module page subtitle after completion: ${subtitle}`);

  // now check owner results page
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="login"]', "owner");
  await page.fill('input[name="password"]', "owner123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/schedule|\/$/, { timeout: 10000 });
  await page.goto(`${BASE}/training/results`);
  const resultsBody = await page.locator("body").innerText();
  if (!resultsBody.includes("Бегимай")) throw new Error("owner results page missing employee attempt");
  log("owner results page shows Бегимай's attempt");

  log("ALL CHECKS PASSED");
} catch (err) {
  console.error("[smoke] FAILURE:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
