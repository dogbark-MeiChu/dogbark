import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceSummary, countQualifyingDeals, deriveEvidenceBand } from './reputationService.js';

const at = (day) => `2026-08-${String(day).padStart(2, '0')}T00:00:00Z`;
const deal = (counterpartyId, day = 1, handoverVerified = true) => ({ counterpartyId, completedAt: at(day), handoverVerified });

test('buyer and seller evidence are role-labelled independently', () => {
  const buyer = buildEvidenceSummary({ role: 'buyer', deals: [deal('a')] });
  const seller = buildEvidenceSummary({ role: 'seller', deals: [] });
  assert.equal(buyer.role, 'buyer');
  assert.equal(buyer.completedDeals, 1);
  assert.equal(seller.role, 'seller');
  assert.equal(seller.completedDeals, 0);
});

test('three counterparties and a verified handover establish a trader', () => {
  const out = buildEvidenceSummary({ role: 'buyer', deals: [deal('a'), deal('b'), deal('c')] });
  assert.equal(out.band, 'established');
  assert.equal(out.distinctCounterparties, 3);
});

test('three deals with one counterparty remain new', () => {
  const out = buildEvidenceSummary({ role: 'buyer', deals: [deal('a', 1), deal('a', 2), deal('a', 3)] });
  assert.equal(out.completedDeals, 3);
  assert.equal(out.qualifyingDeals, 1);
  assert.equal(out.band, 'new');
});

test('same counterparty can contribute again only after 30 days', () => {
  const rows = [
    { counterpartyId: 'a', completedAt: '2026-01-01T00:00:00Z' },
    { counterpartyId: 'a', completedAt: '2026-01-10T00:00:00Z' },
    { counterpartyId: 'a', completedAt: '2026-02-01T00:00:00Z' },
  ];
  assert.equal(countQualifyingDeals(rows), 2);
});

test('a handover is required for established status', () => {
  const out = buildEvidenceSummary({ role: 'seller', deals: [deal('a', 1, false), deal('b', 2, false), deal('c', 3, false)] });
  assert.equal(out.band, 'new');
});

test('small samples do not produce a misleading average', () => {
  assert.equal(buildEvidenceSummary({ role: 'buyer', ratings: [5, 5, 5, 5] }).averageRating, null);
  assert.equal(buildEvidenceSummary({ role: 'buyer', ratings: [5, 4, 5, 4, 5] }).averageRating, 4.6);
});

test('no history is neutral, not low trust', () => {
  const out = buildEvidenceSummary({ role: 'buyer' });
  assert.equal(out.band, 'new');
  assert.equal(out.historyLabel, 'No completed history yet');
});

test('account restriction is an explicit state, not a hidden score', () => {
  const out = buildEvidenceSummary({ role: 'buyer', accountStatus: 'suspended', deals: [deal('a'), deal('b'), deal('c')] });
  assert.equal(out.band, 'restricted');
  assert.equal(deriveEvidenceBand(out), 'restricted');
});
