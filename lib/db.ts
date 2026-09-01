import { env } from 'cloudflare:workers';

export function getDatabase(): D1Database {
  if (!env.DB) {
    throw new Error('O banco de dados do site ainda nao esta disponivel.');
  }
  return env.DB;
}

export function getRuntimeSecret(name: keyof Cloudflare.Env): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
