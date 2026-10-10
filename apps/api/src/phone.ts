// Nigerian phone normalization to E.164: 08067935929, 8067935929 and
// +2348067935929 all become +2348067935929 — one account per number.
// Anything already international (or otherwise valid) passes through
// unchanged. Throws on invalid input; callers map that to 400/401/429.
export function normalizePhone(raw: string): string {
  const clean = String(raw ?? '').replace(/\s/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(clean)) throw new Error('invalid phone format');
  if (/^0\d{10}$/.test(clean)) return '+234' + clean.slice(1); // 080... → +23480...
  if (/^\d{10}$/.test(clean)) return '+234' + clean; // 806... → +234806...
  return clean;
}
