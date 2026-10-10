import './env.js';
import { all, run } from './db.js';
import { normalizePhone } from './phone.js';

// One-time phone-format migration: rewrite stored phones to E.164 without
// ever deleting data.
//
//   npm run migrate:phones --workspace=apps/api                  (dry run, read-only)
//   npm run migrate:phones --workspace=apps/api -- --apply --i-confirm   (writes)
//
// Dry run prints three lists: already-canonical rows, rows it would update,
// and CONFLICT groups (two or more rows normalizing to the same number,
// including a row that already holds it). Apply mode updates only the
// unambiguous rows and SKIPS conflict groups for manual review — it never
// deletes or merges rows. Point DATABASE_URL at the target DB first; the
// script refuses --apply without --i-confirm.
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirmed = args.includes('--i-confirm');
  if (apply && !confirmed) {
    console.error('[migrate:phones] refusing --apply without --i-confirm (dry run is the default)');
    process.exit(2);
  }

  const rows = (await all('SELECT id, role, phone, active FROM users ORDER BY phone')) as any[];
  const groups = new Map<string, any[]>();
  let skipped = 0;
  for (const r of rows) {
    let n: string;
    try {
      n = normalizePhone(r.phone);
    } catch {
      skipped++; // not a phone at all (e.g. deleted_<uuid> scrub rows) — leave alone
      continue;
    }
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n)!.push(r);
  }

  const updates: { id: string; from: string; to: string }[] = [];
  const conflicts: { normalized: string; rows: any[] }[] = [];
  for (const [n, rs] of groups) {
    if (rs.length > 1) {
      conflicts.push({ normalized: n, rows: rs });
    } else if (rs[0].phone !== n) {
      updates.push({ id: rs[0].id, from: rs[0].phone, to: n });
    }
  }

  console.log(`[migrate:phones] ${apply ? 'APPLY' : 'DRY RUN'}: ${rows.length} user rows, ${skipped} non-phone skipped`);
  console.log(`[migrate:phones] already canonical: ${rows.length - skipped - updates.length - conflicts.reduce((s, c) => s + c.rows.length, 0)}`);
  for (const u of updates) console.log(`[migrate:phones] ${apply ? 'UPDATE' : 'would update'} ${u.id} ${u.from} -> ${u.to}`);
  for (const c of conflicts) {
    console.log(`[migrate:phones] CONFLICT ${c.normalized} claimed by ${c.rows.length} rows (manual review, left untouched):`);
    for (const r of c.rows) console.log(`[migrate:phones]   - ${r.id} role=${r.role} phone=${r.phone} active=${r.active}`);
  }

  if (apply) {
    for (const u of updates) {
      await run('UPDATE users SET phone=? WHERE id=?', u.to, u.id);
    }
    console.log(`[migrate:phones] applied ${updates.length} updates, skipped ${conflicts.length} conflict groups, deleted 0 rows`);
  } else {
    console.log('[migrate:phones] dry run only — no writes. Re-run with --apply --i-confirm to write.');
  }
}

const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('apps/api/src/migrate-phones.ts');
if (isMain) {
  main().catch((e) => {
    console.error('[migrate:phones] failed', e?.message ?? e);
    process.exit(1);
  });
}
