import { chromium } from "playwright";
import pg from "pg";

const BASE = "http://localhost:3100";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows: course } = await pool.query("select id from courses where slug = 'm1'");
const courseId = course[0].id;
const { rows: correctOptions } = await pool.query(
  `select qq.id as question_id, qo.id as option_id
   from quiz_questions qq
   join quiz_options qo on qo.question_id = qq.id and qo.is_correct = true
   where qq.course_id = $1`,
  [courseId]
);
await pool.end();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();

await page.goto(`${BASE}/login`);
await page.fill('input[name="login"]', "nurila");
await page.fill('input[name="password"]', "nurila123");
await page.click('button[type="submit"]');
await page.waitForURL(/\/schedule|\/$/, { timeout: 10000 });

await page.goto(`${BASE}/training/m1/quiz`);
for (const { question_id, option_id } of correctOptions) {
  await page.check(`input[name="q_${question_id}"][value="${option_id}"]`);
}
await page.click('button:has-text("Завершить тест")');
await page.waitForURL(/\/training\/m1\/quiz\/result\//, { timeout: 10000 });
const heading = await page.locator("h1").innerText();
console.log("[smoke-pass] heading:", heading);
if (!heading.includes("сдан") || heading.includes("не сдан")) {
  console.error("[smoke-pass] FAILURE: expected a passing result with all-correct answers");
  process.exitCode = 1;
} else {
  console.log("[smoke-pass] ALL CHECKS PASSED (100% correct -> pass)");
}

await browser.close();
