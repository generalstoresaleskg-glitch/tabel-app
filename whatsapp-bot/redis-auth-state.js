// Хранилище сессии WhatsApp (Baileys) в Redis вместо локальных файлов.
//
// Baileys из коробки умеет сохранять сессию только на диск
// (useMultiFileAuthState). Диск у бесплатных/обычных сервисов на Render не
// переживает передеплой (а на бесплатном тарифе — иногда и "засыпание"), а
// значит без этого пришлось бы каждый раз заново сканировать QR-код. Redis
// (Render Key Value) переживает и то, и другое, поэтому сессия хранится там —
// повторное сканирование нужно только один раз, при самой первой настройке.
//
// Структура один в один повторяет официальную useMultiFileAuthState — просто
// вместо fs.readFile/writeFile используются redis.get/set.
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

export async function useRedisAuthState(redis, prefix = "baileys") {
  const key = (name) => `${prefix}:${name}`;

  async function readData(name) {
    const raw = await redis.get(key(name));
    if (!raw) return null;
    try {
      return JSON.parse(raw, BufferJSON.reviver);
    } catch {
      return null;
    }
  }

  async function writeData(name, data) {
    await redis.set(key(name), JSON.stringify(data, BufferJSON.replacer));
  }

  async function removeData(name) {
    await redis.del(key(name));
  }

  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const name = `${category}-${id}`;
              tasks.push(value ? writeData(name, value) : removeData(name));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData("creds", creds),
    // Полный сброс сессии — используется, если WhatsApp разлогинил бота
    // (например, владелец сам отвязал устройство в приложении) и нужно
    // заново сканировать QR с нуля, а не пытаться переподключиться со
    // старыми, уже недействительными ключами.
    clearAll: async () => {
      const keys = await redis.keys(key("*"));
      if (keys.length) await redis.del(...keys);
    },
  };
}
