/**
 * GitHub App mode (multi-user sign-in) is on when the App's credentials are configured. Without
 * them the app runs in single-user mode: one personal token (GITHUB_TOKEN) and an optional
 * DASHBOARD_PASSWORD, exactly as before. Safe to import from middleware (no Node APIs).
 */
export function isAppMode(): boolean {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_APP_CLIENT_ID &&
    process.env.GITHUB_APP_CLIENT_SECRET &&
    process.env.AUTH_SECRET
  );
}

export function appConfig() {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    appId: need("GITHUB_APP_ID"),
    // Vercel and .env files often store the PEM with literal "\n" sequences; accept both forms
    privateKey: need("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
    clientId: need("GITHUB_APP_CLIENT_ID"),
    clientSecret: need("GITHUB_APP_CLIENT_SECRET"),
    authSecret: need("AUTH_SECRET"),
  };
}
