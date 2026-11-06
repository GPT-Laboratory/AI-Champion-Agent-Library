const env = process.env;
const errors = [];
const has = key => Boolean(env[key]?.trim());
if (env.AUTH_ENABLED?.trim().toLowerCase() !== 'false') {
  if (![env.AUTH_ALLOWED_EMAILS, env.AUTH_ALLOWED_EMAIL_DOMAINS].some(v => v?.split(',').some(x => x.trim())))
    errors.push('AUTH_ALLOWED_EMAILS or AUTH_ALLOWED_EMAIL_DOMAINS is required');
  if (!has('AUTH_EMAIL_FROM')) errors.push('AUTH_EMAIL_FROM is required');
  if (!has('SMTP_SERVER') && !has('BREVO_API_KEY')) errors.push('SMTP_SERVER or BREVO_API_KEY is required');
  if (has('SMTP_SERVER') && has('SMTP_PORT') && (!/^\d+$/.test(env.SMTP_PORT) || +env.SMTP_PORT < 1 || +env.SMTP_PORT > 65535))
    errors.push('SMTP_PORT must be between 1 and 65535');
}
if (!has('ORIGIN')) errors.push('ORIGIN is required');
else { try { const u = new URL(env.ORIGIN); if (!['http:', 'https:'].includes(u.protocol)) throw Error(); } catch { errors.push('ORIGIN must be an HTTP(S) URL'); } }
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Deployment environment checks passed');
