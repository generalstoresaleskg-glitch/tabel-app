// Запуск двух ботов в одном сервисе Render.
//
// main  — номер владельца (BOT_PHONE): уведомления о приходе/уходе, /клиент,
//         дни рождения. Слушает публичный порт Render.
// store — номер магазина (STORE_BOT_PHONE): только сбор переписок с клиентами
//         и анализ через DeepSeek. Слушает внутренний порт, его страницы
//         открываются через главный: /store/qr?token=…, /store/pair?token=…
//
// Два процесса, а не два сервиса: бесплатных часов Render на месяц хватает
// только на один постоянно работающий сервис.
// Второй бот выключается переменной STORE_BOT=off.
import { fork } from "node:child_process";

const here = new URL("./index.js", import.meta.url).pathname;

function run(name, env) {
  const child = fork(here, [], { env: { ...process.env, ...env }, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    console.error(`[start] бот ${name} завершился (code=${code}, signal=${signal}) — перезапуск через 10 секунд`);
    setTimeout(() => run(name, env), 10_000);
  });
}

run("main", { BOT_ROLE: "main" });

if (process.env.STORE_BOT !== "off") {
  run("store", {
    BOT_ROLE: "store",
    BASE_PATH: "/store",
    SESSION_PREFIX: "store",
    BOT_PHONE: process.env.STORE_BOT_PHONE || "996222904448",
    CHAT_ANALYSIS: "on",
  });
}
