import test from 'node:test';
import assert from 'node:assert';
import {
  TOOLS,
  computeDecreeCompliance,
  handleToolCall,
} from '../src/index.ts';

test('Soumit MCP server exposes required procurement intelligence tools', () => {
  const toolNames = TOOLS.map((t) => t.name);
  assert.ok(toolNames.includes('search_tenders'));
  assert.ok(toolNames.includes('get_tender_details'));
  assert.ok(toolNames.includes('check_regulatory_compliance'));
  assert.ok(toolNames.includes('search_competitor_awards'));
  assert.ok(toolNames.includes('get_market_barometer'));
  assert.ok(toolNames.includes('audit_submission_checklist'));

  for (const tool of TOOLS) {
    assert.ok(tool.name, 'Tool must have name');
    assert.ok(tool.description, 'Tool must have description');
    assert.strictEqual(tool.inputSchema.type, 'object', 'inputSchema must be object');
  }
});

test('Moroccan Procurement Decree 2-22-431 compliance calculator', () => {
  // 1. Compliant offer in Fournitures (within -25% and +20%)
  const compliant = computeDecreeCompliance({
    estimatedAmountHt: 1000000,
    proposedAmountHt: 850000,
    sectorType: 'fournitures',
  });
  assert.strictEqual(compliant.status, 'CONFORME');
  assert.strictEqual(compliant.floorAmount, 750000);
  assert.strictEqual(compliant.ceilingAmount, 1200000);
  assert.strictEqual(compliant.discountPct, 15);

  // 2. Abnormally low offer in Travaux (below -20%)
  const lowTravaux = computeDecreeCompliance({
    estimatedAmountHt: 1000000,
    proposedAmountHt: 780000,
    sectorType: 'travaux',
  });
  assert.strictEqual(lowTravaux.status, 'OFFRE_ANORMALEMENT_BASSE');
  assert.strictEqual(lowTravaux.floorAmount, 800000);
  assert.ok(lowTravaux.statusText.includes('OFFRE ANORMALEMENT BASSE'));

  // 3. Excessive offer (exceeding +20%)
  const excessive = computeDecreeCompliance({
    estimatedAmountHt: 1000000,
    proposedAmountHt: 1250000,
  });
  assert.strictEqual(excessive.status, 'OFFRE_EXCESSIVE');
  assert.strictEqual(excessive.ceilingAmount, 1200000);
  assert.ok(excessive.statusText.includes('OFFRE EXCESSIVE'));
});

test('Tool call for compliance analysis produces structured report', async () => {
  const result = await handleToolCall('check_regulatory_compliance', {
    estimated_amount_ht: 500000,
    proposed_amount_ht: 400000,
    sector_type: 'fournitures',
  });

  assert.ok(Array.isArray(result.content));
  assert.ok(result.content[0].text.includes('Décret n° 2-22-431'));
  assert.ok(result.content[0].text.includes('CONFORME'));
});

test('Tool call for submission checklist evaluates mandatory documents', async () => {
  const rejected = await handleToolCall('audit_submission_checklist', {
    tender_reference: '45/CHU/2026',
    has_provisional_guarantee: false,
    has_declaration_on_honor: true,
  });

  assert.ok(rejected.content[0].text.includes('RISQUE CRITIQUE D\'ÉLIMINATION'));
  assert.ok(rejected.content[0].text.includes('Cautionnement provisoire'));

  const valid = await handleToolCall('audit_submission_checklist', {
    tender_reference: '45/CHU/2026',
    has_provisional_guarantee: true,
    has_declaration_on_honor: true,
  });

  assert.ok(valid.content[0].text.includes('DOSSIER RECEVABLE'));
});
