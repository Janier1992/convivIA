import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, ErrorCodes } from "../utils/AppError.js";
import { logger } from "../lib/logger.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Los datos enviados no son válidos.",
        details: err.flatten()
      }
    });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, "unhandled_error");
  res.status(500).json({
    error: { code: ErrorCodes.INTERNAL_ERROR, message: "Ocurrió un error inesperado." }
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Ruta no encontrada: ${req.path}` } });
}
