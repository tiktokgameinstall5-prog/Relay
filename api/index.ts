import 'reflect-metadata';

export default async function handler(req: any, res: any) {
  try {
    const main = await import('../apps/api/src/main');
    return await main.default(req, res);
  } catch (err: any) {
    console.error('API Handler Error:', err);
    res.status(500).json({
      error: err.message,
      stack: err.stack,
    });
  }
}
