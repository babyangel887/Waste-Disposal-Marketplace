import './env.js';
import { demoteDefaultAdmin } from './seed.js';

// One-time production cleanup: demote the legacy default admin row.
// Usage: npm run cleanup:default-admin --workspace=apps/api
async function main() {
  await demoteDefaultAdmin();
}

const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('apps/api/src/cleanup-default-admin.ts');
if (isMain) {
  main().catch((e) => {
    console.error('[cleanup:default-admin] failed', e?.message ?? e);
    process.exit(1);
  });
}
