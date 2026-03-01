import { Bot } from "grammy";
import {
  createLogger,
  getEnv,
  closeDb,
  closeRedis,
} from "@flash-pump/shared";
import { registerCommands } from "./commands";
import { startAlerts, stopAlerts } from "./alerts";

const log = createLogger("telegram-bot");

async function main(): Promise<void> {
  log.info("Starting telegram-bot");

  const env = getEnv();

  // Initialize grammy bot
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  const chatId = env.TELEGRAM_CHAT_ID;

  // Register command handlers
  registerCommands(bot);

  // Error handler
  bot.catch((err) => {
    log.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Bot error");
  });

  // Start Redis event alerts
  startAlerts(bot, chatId);

  // Start polling for Telegram updates
  bot.start({
    onStart: () => {
      log.info("Bot polling started");
    },
  });

  // Send startup notification
  try {
    await bot.api.sendMessage(chatId, "🚀 Flash Pump Engine Bot started");
  } catch (err) {
    log.warn({ err }, "Failed to send startup message (chat may not exist yet)");
  }

  log.info("Telegram bot running");

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down telegram-bot...");

    try {
      await bot.api.sendMessage(chatId, "🔴 Flash Pump Engine Bot shutting down");
    } catch {
      // Ignore send errors during shutdown
    }

    bot.stop();
    await stopAlerts();
    await closeDb();
    await closeRedis();

    log.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.fatal({ error: err }, "Fatal error");
  process.exit(1);
});
