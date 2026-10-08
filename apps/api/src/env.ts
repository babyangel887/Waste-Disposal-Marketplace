import path from 'node:path';
import fs from 'node:fs';

// Load the project-root .env using Node's built-in loader (no new package).
// dotenv/config only reads cwd, which misses the root .env when the API
// runs from apps/api. Never log any value from the file.
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '..', '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];
for (const f of candidates) {
  try {
    if (fs.existsSync(f)) process.loadEnvFile(f);
  } catch {
    // Ignore unreadable candidates; values must never be printed.
  }
}

// Startup line prints the mode only — never the key or any .env value.
console.log(`[otp] mode=${process.env.OTP_MODE ?? 'mock'}`);
