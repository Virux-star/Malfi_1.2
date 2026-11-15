import pg from 'pg';

export function databaseConfig(env = process.env) {
  // Use the provider's certificate chain. Never silently disable TLS validation.
  const ssl = env.DB_SSL === 'true' ? { rejectUnauthorized: true,
    ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) } : undefined;
  return {
    ...(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
      host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
      user: env.DB_USER || 'postgres', password: env.DB_PASSWORD, database: env.DB_NAME || 'malfi'
    }),
    ...(ssl ? { ssl } : {}), max: 10, connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000
  };
}
export const createPool = () => new pg.Pool(databaseConfig());
