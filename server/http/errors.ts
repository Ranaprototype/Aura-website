import type { ErrorRequestHandler, Response } from "express";

export const fail = (res: Response, status: number, error: string) =>
  res.status(status).json({ error });
export const errors: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.too.large")
    return fail(res, 413, "payload_too_large");
  if (err.type === "entity.parse.failed") return fail(res, 400, "invalid_json");
  if (err.status === 415) return fail(res, 415, "unsupported_media_type");
  return fail(res, 500, "internal_error");
};
