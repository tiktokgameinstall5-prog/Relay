import 'reflect-metadata';

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
    console.error('Serverless Execution Error:', err);
    res.status(500).json({
      message: 'Serverless Function Execution Error',
      error: err.message,
      stack: err.stack,
    });
  }
}
