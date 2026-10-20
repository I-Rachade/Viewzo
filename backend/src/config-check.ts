/**
 * Refuses to start in production with settings that are only safe on a
 * developer machine: free payments, login codes written to the log, shared
 * or weak keys.
 */
export function checkProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (env.PAYMENT_MODE === 'local' && env.ALLOW_TEST_PAYMENTS !== 'yes') {
    problems.push(
      'PAYMENT_MODE=local makes every top-up free (set ALLOW_TEST_PAYMENTS=yes only before launch)',
    );
  }
  if (env.OTP_PROVIDER !== 'didit') {
    problems.push('OTP_PROVIDER must be didit (codes would be logged)');
  }
  if (!env.MAIL_PROVIDER) {
    problems.push('MAIL_PROVIDER is empty (email codes would be logged)');
  }
  for (const key of ['JWT_SECRET', 'OTP_SECRET', 'TOKEN_ENCRYPTION_KEY']) {
    if ((env[key] ?? '').length < 32) {
      problems.push(`${key} must be at least 32 characters`);
    }
  }
  if (env.TOKEN_ENCRYPTION_KEY && env.TOKEN_ENCRYPTION_KEY === env.JWT_SECRET) {
    problems.push('TOKEN_ENCRYPTION_KEY must differ from JWT_SECRET');
  }
  if (problems.length) {
    throw new Error(`Unsafe production settings:\n- ${problems.join('\n- ')}`);
  }
}
