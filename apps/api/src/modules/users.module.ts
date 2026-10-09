import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Put,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { roles } from '../../../../packages/core/src';
import { db, redis } from '../analytics';
import { Roles } from '../auth';
import { audit, parse } from '../module-support';
import { cookieName, passwordHash, sessionCookie, sessionHash, verifyPassword } from '../local-auth';
const userSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,64}$/),
  name: z.string().trim().min(1).max(100),
  roles: z.array(z.enum(roles)).min(1),
  enabled: z.boolean().default(true),
  password: z.string().min(5).max(128).optional(),
});
const publicColumns = 'user_id,username,display_name,roles,enabled,created_at';
@Controller()
export class UsersController {
  @Post('auth/login') @SetMetadata('public', true) async login(
    @Body() body: any,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    if ((process.env.AUTH_MODE || 'local') !== 'local') throw new UnauthorizedException();
    const data = parse(
      z.object({
        username: z.string().trim().toLowerCase().min(1).max(64),
        password: z.string().min(1).max(128),
      }),
      body,
    );
    const throttleKey = 'login:' + sessionHash(req.ip || 'unknown');
    const attempts = await redis.incr(throttleKey);
    if (attempts === 1) await redis.expire(throttleKey, 60);
    if (attempts > 20) throw new UnauthorizedException('Too many attempts. Try again in one minute.');
    const users = await db.$queryRaw<any[]>`SELECT * FROM app_user WHERE username=${data.username}`;
    const user = users[0];
    const fallback = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = await verifyPassword(data.password, user?.password_hash || fallback);
    if (!user || !valid || !user.enabled || (user.locked_until && new Date(user.locked_until) > new Date())) {
      if (user)
        await db.$executeRaw`UPDATE app_user SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts>=4 THEN now()+interval '15 minutes' ELSE locked_until END WHERE user_id=${user.user_id}::uuid`;
      await db.audit.create({
        data: {
          actor: user?.user_id || 'anonymous',
          action: 'auth.login.failed',
          resource: 'local',
          details: {},
        },
      });
      throw new UnauthorizedException('Invalid username or password, or account temporarily locked.');
    }
    const token = randomBytes(32).toString('hex');
    await db.$transaction([
      db.$executeRaw`UPDATE app_user SET failed_attempts=0,locked_until=NULL WHERE user_id=${user.user_id}::uuid`,
      db.$executeRaw`DELETE FROM auth_session WHERE expires_at<now()`,
      db.$executeRaw`INSERT INTO auth_session(token_hash,user_id,expires_at) VALUES(${sessionHash(token)},${user.user_id}::uuid,now()+interval '8 hours')`,
    ]);
    res.setHeader('Set-Cookie', sessionCookie(token));
    await audit({ user: { id: user.user_id } }, 'auth.login', 'local');
    return { id: user.user_id, username: user.username, name: user.display_name, roles: user.roles };
  }
  @Post('auth/logout') async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const token = (req.headers.cookie || '')
      .split(';')
      .map((s: string) => s.trim())
      .find((s: string) => s.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    if (token) await db.$executeRaw`DELETE FROM auth_session WHERE token_hash=${sessionHash(token)}`;
    res.setHeader('Set-Cookie', sessionCookie('', true));
    return { ok: true };
  }
  @Post('auth/password') async password(
    @Body() body: any,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const data = parse(
      z.object({ currentPassword: z.string().max(128), password: z.string().min(5).max(128) }),
      body,
    );
    const [user] = await db.$queryRaw<
      any[]
    >`SELECT password_hash FROM app_user WHERE user_id=${req.user.id}::uuid`;
    if (!user || !(await verifyPassword(data.currentPassword, user.password_hash)))
      throw new UnauthorizedException('Current password is incorrect');
    await db.$transaction([
      db.$executeRaw`UPDATE app_user SET password_hash=${await passwordHash(data.password)},updated_at=now() WHERE user_id=${req.user.id}::uuid`,
      db.$executeRaw`DELETE FROM auth_session WHERE user_id=${req.user.id}::uuid`,
    ]);
    await audit(req, 'user.password.change', req.user.id);
    res.setHeader('Set-Cookie', sessionCookie('', true));
    return { ok: true };
  }
  @Get('users') @Roles('Administrator') list() {
    return db.$queryRawUnsafe(`SELECT ${publicColumns} FROM app_user ORDER BY username`);
  }
  @Post('users') @Roles('Administrator') async create(@Body() body: any, @Req() req: any) {
    const d = parse(userSchema, body);
    if (!d.password) throw new BadRequestException('Password is required');
    const id = randomUUID();
    try {
      await db.$executeRaw`INSERT INTO app_user(user_id,username,display_name,password_hash,roles,enabled) VALUES(${id}::uuid,${d.username},${d.name},${await passwordHash(d.password)},${d.roles}::text[],${d.enabled})`;
    } catch (e: any) {
      if (e.meta?.code === '23505') throw new BadRequestException('Username already exists');
      throw e;
    }
    await audit(req, 'user.create', id);
    return { id };
  }
  @Put('users/:id') @Roles('Administrator') async update(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    parse(z.string().uuid(), id);
    const d = parse(userSchema, body);
    const [existing] = await db.$queryRaw<
      any[]
    >`SELECT username,password_hash FROM app_user WHERE user_id=${id}::uuid`;
    if (!existing) throw new BadRequestException('User does not exist');
    if (
      existing.username === 'admin' &&
      (!d.enabled || !d.roles.includes('Administrator') || d.username !== 'admin')
    )
      throw new BadRequestException('The admin account must remain enabled with Administrator access');
    if (id === req.user.id && (!d.enabled || !d.roles.includes('Administrator')))
      throw new BadRequestException('You cannot remove your own administrative access');
    const hash = d.password ? await passwordHash(d.password) : existing.password_hash;
    await db.$transaction([
      db.$executeRaw`UPDATE app_user SET username=${d.username},display_name=${d.name},roles=${d.roles}::text[],enabled=${d.enabled},password_hash=${hash},failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=${id}::uuid`,
      db.$executeRaw`DELETE FROM auth_session WHERE user_id=${id}::uuid`,
    ]);
    await audit(req, 'user.update', id, { passwordReset: !!d.password });
    return { ok: true };
  }
}
@Module({ controllers: [UsersController] })
export class UsersModule {}
