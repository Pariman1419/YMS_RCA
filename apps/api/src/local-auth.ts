import { scrypt as derive, randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './analytics';
const scrypt = promisify(derive);
export const cookieName = 'nexus_session';
export function sessionHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hex] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function bootstrapAdmin() {
  const hash = await passwordHash(process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin');
  await db.$executeRaw`INSERT INTO app_user(user_id,username,display_name,password_hash,roles)
 VALUES (${randomUUID()}::uuid,'admin','Administrator',${hash},ARRAY['Administrator']) ON CONFLICT(username) DO NOTHING`;
}
export async function localIdentity(req: any) {
  const token = (req.headers.cookie || '')
    .split(';')
    .map((s: string) => s.trim())
    .find((s: string) => s.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await db.$queryRaw<any[]>`SELECT u.user_id AS id,u.username,u.display_name AS name,u.roles
 FROM auth_session s JOIN app_user u ON u.user_id=s.user_id
 WHERE s.token_hash=${sessionHash(token)} AND s.expires_at>now() AND u.enabled=true`;
  return rows[0] || null;
}
export function sessionCookie(token: string, expired = false) {
  return `${cookieName}=${token}; HttpOnly; Path=/api; SameSite=Strict; Max-Age=${expired ? 0 : 28800}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
