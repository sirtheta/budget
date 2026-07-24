import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Default pino timestamps are a raw epoch integer, which is unreadable in
  // `docker logs`; ISO-8601 is both human-scannable and still greppable.
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
