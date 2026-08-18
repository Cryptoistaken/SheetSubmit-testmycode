import type { NextFunction, Request, Response } from "express";

// Central error handler — the old server had none (sync throws crashed the
// request). Returns JSON without changing any endpoint's documented behavior.
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[Error] " + err.message);
  res.status(500).json({ error: "Internal server error" });
}
