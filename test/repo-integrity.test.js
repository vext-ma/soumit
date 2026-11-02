import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Soumit project OpenAPI 3.1 contract is complete, current, and clean of internal leaks', () => {
  const openApiPath = path.join(rootDir, 'openapi.json');
  assert.ok(fs.existsSync(openApiPath), 'openapi.json must exist');

  const content = fs.readFileSync(openApiPath, 'utf8');
  const spec = JSON.parse(content);

  assert.strictEqual(spec.openapi, '3.1.0');
  assert.strictEqual(spec.info.title, 'Soumit Public API');
  assert.strictEqual(Object.keys(spec.paths).length, 24, 'OpenAPI must contain exactly 24 public consumer paths');

  const prohibitedTokens = [
    'internal/webhook-dispatch',
    'internal/pipeline-watchdog',
    'cloudflare_account_id',
    '4a29cd67',
    '10d74fab',
    '4856d1cf',
    'pilot-api-key',
    'stripe_webhook',
    'company-profile/match',
    'sk_live_VNwddo1D4uQpJEli_lJO37c37rvlOPiEvYYvHseIMrbXVq8UFsFH91zBA',
  ];

  for (const forbidden of prohibitedTokens) {
    assert.ok(
      !content.toLowerCase().includes(forbidden.toLowerCase()),
      `OpenAPI contract MUST NOT leak internal token or path: ${forbidden}`,
    );
  }
});

test('Soumit packages and documentation are present and structured', () => {
  const expectedDirs = [
    path.join(rootDir, 'docs'),
    path.join(rootDir, 'examples'),
    path.join(rootDir, 'packages', 'soumit-api'),
    path.join(rootDir, 'packages', 'soumit-mcp'),
  ];

  for (const dir of expectedDirs) {
    assert.ok(fs.existsSync(dir), `Directory ${dir} must exist`);
  }

  const expectedDocs = [
    'architecture.md',
    'authentication.md',
    'data-model.md',
    'decree-2-22-431.md',
    'errors.md',
    'pagination.md',
    'rate-limits.md',
    'webhooks.md',
  ];

  for (const doc of expectedDocs) {
    assert.ok(fs.existsSync(path.join(rootDir, 'docs', doc)), `Doc ${doc} must exist`);
  }
});

test('Moroccan Procurement Décret n° 2-22-431 calculations are accurate', async () => {
  const { computeDecreeCompliance } = await import('../packages/soumit-mcp/src/index.ts');

  // Case 1: Compliant bid
  const normal = computeDecreeCompliance({
    estimatedAmountHt: 1000000,
    proposedAmountHt: 900000,
    sectorType: 'travaux',
  });
  assert.strictEqual(normal.status, 'CONFORME');

  // Case 2: Abnormally low for Travaux (-25% exceeds -20% threshold)
  const lowWorks = computeDecreeCompliance({
    estimatedAmountHt: 1000000,
    proposedAmountHt: 750000,
    sectorType: 'travaux',
  });
  assert.strictEqual(lowWorks.status, 'OFFRE_ANORMALEMENT_BASSE');

  // Case 3: Excessive (+25% exceeds +20% ceiling)
  const excessive = computeDecreeCompliance({
    estimatedAmountHt: 1000000,
    proposedAmountHt: 1250000,
  });
  assert.strictEqual(excessive.status, 'OFFRE_EXCESSIVE');
});
