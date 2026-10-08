// Single place for the API base URL. No hardcoded URLs in screens.
// Set via EXPO_PUBLIC_API_URL (see .env + eas.json); falls back to Render prod.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://waste-disposal-marketplace.onrender.com';

export function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export const TOKEN_KEY = 'customer.authToken';
