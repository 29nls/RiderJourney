import request from 'supertest';

export type TestApi = ReturnType<typeof request>;

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function registerUser(api: TestApi, username: string, displayName: string) {
  const response = await api.post('/v1/auth/register').send({
    email: `${username}@example.com`,
    username,
    displayName,
    password: 'correct-horse-battery',
  });
  if (response.status !== 201) throw new Error(`register ${username} failed: ${response.status} ${JSON.stringify(response.body)}`);
  const me = await api.get('/v1/me').set(auth(response.body.accessToken));
  return { token: response.body.accessToken as string, id: me.body.id as string };
}

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

export async function uploadImage(
  api: TestApi,
  token: string,
  clientMediaId: string,
  purpose = 'post_photo',
  declaredBytes = 4096,
): Promise<{ id: string; uploadUrl: string }> {
  const intent = await api
    .post('/v1/media/uploads')
    .set(auth(token))
    .send({ purpose, contentType: 'image/jpeg', sizeBytes: declaredBytes, clientMediaId });
  if (intent.status !== 201) throw new Error(`media intent failed: ${intent.status} ${JSON.stringify(intent.body)}`);
  const complete = await api
    .post(`/v1/media/uploads/${intent.body.id}/complete`)
    .set(auth(token))
    .field('sizeBytes', String(JPEG_HEAD.length))
    .attach('file', JPEG_HEAD, { filename: 'sample.jpg', contentType: 'image/jpeg' });
  if (complete.status !== 200) throw new Error(`media complete failed: ${complete.status} ${JSON.stringify(complete.body)}`);
  return { id: intent.body.id as string, uploadUrl: intent.body.uploadUrl as string };
}

export function farAwaySpikePoint() {
  return { lat: -6.6, lng: 107.3 };
}
