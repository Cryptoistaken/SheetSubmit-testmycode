// Bot routes — registered only when a bot token is configured (mirrors old server).
import { Router } from "express";
import { botUsername, handleBotUpdate } from "../services/telegram";

// /api/bot/info (old: app.get('/api/bot/info'))
export function createBotRouter(): Router {
  const botRouter = Router();

  botRouter.get("/bot/info", (_req, res) => {
    res.json({ username: botUsername });
  });

  return botRouter;
}

// /webhook/tg at ROOT, not under /api — Telegram's registered webhook URL is
// FRONTEND_URL + "/webhook/tg" (old: app.post('/webhook/tg')).
export function createWebhookRouter(): Router {
  const webhookRouter = Router();

  webhookRouter.post("/webhook/tg", (req, res) => {
    res.sendStatus(200);
    void handleBotUpdate(req.body as Parameters<typeof handleBotUpdate>[0]);
  });

  return webhookRouter;
}
