import express from "express";
import { DateTime } from "luxon";
import { buildCalendarPayload } from "./calendar.js";
import { buildConfig } from "./config.js";

export function createServer() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const calendarHandler: express.RequestHandler = async (req, res, next) => {
    try {
      const config = buildConfig(req.query);
      if (config.sourceMode === "ics" && config.sources.length === 0) {
        res.status(400).json({
          error: "No calendars configured. Set FASTMAIL_USERNAME/FASTMAIL_APP_PASSWORD for CalDAV mode or set ICS_URLS for ICS mode.",
        });
        return;
      }
      if (config.sourceMode === "caldav" && (!config.caldavUsername || !config.caldavPassword)) {
        res.status(400).json({
          error: "CalDAV mode requires FASTMAIL_USERNAME and FASTMAIL_APP_PASSWORD.",
        });
        return;
      }
      const payload = await buildCalendarPayload(config, DateTime.now().setZone(config.timezone));
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  app.get("/events", calendarHandler);
  app.get("/calendar", calendarHandler);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    res.status(500).json({ error: message });
  });

  return app;
}
