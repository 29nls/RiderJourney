import type { ObjectHead, ObjectStorage, ObjectStream } from '../media/object-storage.js';

/**
 * Unit-test double only. The integration suite in media.integration.test.ts
 * always talks to a real S3-compatible server through S3ObjectStorage.
 */
export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async presignPut(key: string, contentType: string): Promise<string> {
    void contentType;
    return `https://fake.storage.test/${key}?X-Amz-Signature=fake`;
  }

  async presignGet(key: string): Promise<string> {
    return `https://fake.storage.test/${key}?X-Amz-Signature=fake-get`;
  }

  async head(key: string): Promise<ObjectHead | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return { contentLength: object.body.length, contentType: object.contentType, etag: null };
  }

  async openRead(key: string): Promise<ObjectStream> {
    const object = this.objects.get(key);
    if (!object) throw new Error('fake object missing');
    const body = object.body;
    return {
      contentLength: body.length,
      stream: (async function* () {
        yield body;
      })(),
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  put(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  clear(): void {
    this.objects.clear();
  }
}

export const testStorage = new FakeObjectStorage();
