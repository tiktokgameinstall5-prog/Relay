import 'reflect-metadata';
import express from 'express';

// Express 5 compatibility shim for NestJS @nestjs/platform-express
try {
  Object.defineProperty(express.application, 'router', {
    get() {
      return (this as any)._router;
    },
    configurable: true,
  });
} catch (e) {
  console.warn('Could not patch express.application.router:', e);
}

let cachedHandler: any = null;

export default async function handler(req: any, res: any) {
  try {
    if (!cachedHandler) {
      let main: any;
      try {
        main = require('../apps/api/dist/main');
      } catch {
        main = await import('../apps/api/src/main');
      }
      cachedHandler = main.default || main.getVercelHandler;
    }
    return await cachedHandler(req, res);
  } catch (err: any) {
    cachedHandler = null;
    console.error('Serverless Execution Error:', err);
    if (!res.headersSent && !res.writableEnded) {
      res.status(500).json({
        message: 'Serverless Function Execution Error',
        error: err.message,
        stack: err.stack,
      });
    }
  }
}
