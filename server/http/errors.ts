import type { ErrorRequestHandler, Response } from "express";

/** A client-correctable failure raised by a route handler. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
    this.name = "RequestError";
  }
}

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
