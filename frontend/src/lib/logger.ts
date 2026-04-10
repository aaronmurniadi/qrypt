import { LogFrontend } from "../../wailsjs/go/backend/App";

export const logger = {
  debug: (msg: string) => void LogFrontend("debug", msg),
  info: (msg: string) => void LogFrontend("info", msg),
  warn: (msg: string) => void LogFrontend("warn", msg),
  error: (msg: string) => void LogFrontend("error", msg),
  fatal: (msg: string) => void LogFrontend("fatal", msg),
};
