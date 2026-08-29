import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { LocalStorageDriver } from './local-storage.driver';

describe('LocalStorageDriver', () => {
  const testDir = join(__dirname, '../../test-storage-tmp');
  const driver = new LocalStorageDriver(testDir);

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('puts, gets, and verifies sha256 checksum losslessly', async () => {
    const payload = Buffer.from('Hello lossless master video stream 12345');
    const meta = await driver.put('org1/task1/test.txt', payload, 'text/plain');

    expect(meta.size).toBe(payload.length);
    expect(meta.checksumSha256).toBeDefined();

    const retrieved = await driver.get('org1/task1/test.txt');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.buffer.equals(payload)).toBe(true);

    await driver.delete('org1/task1/test.txt');
    const afterDelete = await driver.get('org1/task1/test.txt');
    expect(afterDelete).toBeNull();
  });
});
