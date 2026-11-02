import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  Soumit,
  SoumitError,
  InvalidRequestError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServerError,
  verifyWebhookSignature,
} from '../src/index.ts';

test('Soumit client enforces API key requirement', () => {
  assert.throws(() => new Soumit({ apiKey: '' }), /API key is required/);
  assert.throws(() => new Soumit({}), /API key is required/);

  const client = new Soumit({ apiKey: 'sk_live_test_dummy_key_12345' });
  assert.strictEqual(client.baseUrl, 'https://soumit.ma');
  assert.ok(client.tenders, 'tenders resource must exist');
  assert.ok(client.awards, 'awards resource must exist');
  assert.ok(client.barometer, 'barometer resource must exist');
  assert.ok(client.boncommandes, 'boncommandes resource must exist');
  assert.ok(client.catalogue, 'catalogue resource must exist');
  assert.ok(client.pursuits, 'pursuits resource must exist');
  assert.ok(client.executive, 'executive resource must exist');
  assert.ok(client.events, 'events resource must exist');
  assert.ok(client.webhooks, 'webhooks resource must exist');
  assert.ok(client.apiKeys, 'apiKeys resource must exist');
});

test('Soumit client custom base URL strips trailing slash', () => {
  const client = new Soumit({
    apiKey: 'sk_live_test',
    baseUrl: 'https://staging.soumit.ma/api-test/',
  });
  assert.strictEqual(client.baseUrl, 'https://staging.soumit.ma/api-test');
});

test('Webhook signature verification with HMAC-SHA256 and timestamp drift defense', async () => {
  const secret = 'whsec_9b2e4f8a1c3d5e7a9b2e4f8a1c3d5e7a';
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    object: 'event',
    id: 'evt_test_123',
    type: 'analysis.completed',
    data: { tender_id: 'tnd_49210_2026', quality_tier: 'decision_ready' },
  });

  // 1. Valid signature
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${now}.${payload}`);
  const validSig = hmac.digest('hex');
  const validHeader = `t=${now},v1=${validSig}`;

  const isValid = await verifyWebhookSignature(secret, validHeader, payload, 300);
  assert.strictEqual(isValid, true, 'Valid signature should verify successfully');

  // 2. Tampered body should fail
  const tamperedPayload = payload.replace('decision_ready', 'degraded');
  const isTamperedValid = await verifyWebhookSignature(secret, validHeader, tamperedPayload, 300);
  assert.strictEqual(isTamperedValid, false, 'Tampered payload should fail verification');

  // 3. Wrong secret should fail
  const isWrongSecretValid = await verifyWebhookSignature('whsec_wrong', validHeader, payload, 300);
  assert.strictEqual(isWrongSecretValid, false, 'Wrong secret should fail verification');

  // 4. Stale timestamp (older than tolerance) should fail
  const oldTimestamp = now - 600; // 10 minutes ago
  const oldHmac = crypto.createHmac('sha256', secret);
  oldHmac.update(`${oldTimestamp}.${payload}`);
  const oldHeader = `t=${oldTimestamp},v1=${oldHmac.digest('hex')}`;
  const isOldValid = await verifyWebhookSignature(secret, oldHeader, payload, 300);
  assert.strictEqual(isOldValid, false, 'Expired timestamp should fail replay verification');

  // 5. Malformed header should fail
  assert.strictEqual(await verifyWebhookSignature(secret, 'garbage_header', payload), false);
  assert.strictEqual(await verifyWebhookSignature(secret, '', payload), false);
});

test('Typed error hierarchy reflects HTTP status and API codes', () => {
  const rateLimitErr = new RateLimitError('Rate limit exceeded', {
    code: 'rate_limited',
    status: 429,
    detail: { retry_after_seconds: 45 },
  });
  assert.strictEqual(rateLimitErr.status, 429);
  assert.strictEqual(rateLimitErr.code, 'rate_limited');
  assert.strictEqual(rateLimitErr.retryAfter, 45);

  const authErr = new AuthenticationError('Unauthorized', {
    code: 'invalid_api_key',
    status: 401,
  });
  assert.strictEqual(authErr.status, 401);
  assert.strictEqual(authErr.code, 'invalid_api_key');

  const notFoundErr = new NotFoundError('Tender not found', {
    code: 'tender_not_found',
    status: 404,
  });
  assert.strictEqual(notFoundErr.status, 404);
});
