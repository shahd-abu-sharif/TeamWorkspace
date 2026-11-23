// apps/api/src/auth/auth.controller.ts
import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public, Roles, SkipWorkspace, CurrentUser } from '../common/decorators';
import { ZodBody } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import {
  ForgotSchema,
  InviteSchema,
  LoginSchema,
  RegisterSchema,
  ProfileSchema,
  ResetSchema,
  type InviteDto,
} from './dto';

const REFRESH_COOKIE = 'tth_refresh';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) { }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@Body(new ZodBody(RegisterSchema)) dto: any, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.register(dto);
    this.setRefreshCookie(res, session.refreshToken);
    return { accessToken: session.accessToken, user: session.user, workspaceId: session.workspaceId };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body(new ZodBody(LoginSchema)) dto: any, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(dto);
    this.setRefreshCookie(res, session.refreshToken);
    return { accessToken: session.accessToken, user: session.user, workspaceId: session.workspaceId };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    const session = await this.auth.refresh(token);
    this.setRefreshCookie(res, session.refreshToken);
    return { accessToken: session.accessToken, user: session.user, workspaceId: session.workspaceId };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { ok: true };
  }

  @Public()
  @Get('invitations/preview')
  preview(@Req() req: Request) {
    return this.auth.previewInvitation(String(req.query.token ?? ''));
  }

  @Get('me')
  @SkipWorkspace()
  me(@CurrentUser() user: { id: string }) {
    return this.auth.me(user.id);
  }

  @Patch('me')
  @SkipWorkspace()
  updateProfile(@CurrentUser() user: { id: string }, @Body(new ZodBody(ProfileSchema)) dto: { name: string }) {
    return this.auth.updateProfile(user.id, dto.name);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  forgot(@Body(new ZodBody(ForgotSchema)) dto: any) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  reset(@Body(new ZodBody(ResetSchema)) dto: any) {
    return this.auth.resetPassword(dto);
  }

  @Roles('LEADER')
  @Post('invitations')
  invite(@Body(new ZodBody(InviteSchema)) dto: InviteDto, @Req() req: any) {
    return this.auth.createInvitation(req.membership.workspaceId, req.user.id, dto);
  }

  @Roles('LEADER')
  @Get('invitations')
  listInvitations(@Req() req: any) {
    return this.auth.listInvitations(req.membership.workspaceId);
  }

  @Roles('LEADER')
  @Post('invitations/:id/revoke')
  revoke(@Req() req: any) {
    return this.auth.revokeInvitation(req.membership.workspaceId, req.params.id);
  }

  /**
   * Refresh-cookie attributes.
   *
   * `SameSite=Lax` is only sent on *same-site* requests. Locally the web app and
   * the API share the `localhost` site (ports do not matter), so Lax is fine —
   * but when the web app is deployed on a different domain than the API
   * (e.g. Vercel frontend + Render API) the cookie is dropped on every XHR and
   * the session looks dead after a page reload. Production therefore defaults to
   * `SameSite=None; Secure`, which a browser accepts for cross-site requests.
   *
   * Override with COOKIE_SAMESITE / COOKIE_SECURE when the frontend is served
   * behind the same domain as the API (a proxy rewrite keeps everything
   * same-origin and `lax` is the safer choice there).
   */
  private cookieOptions() {
    const isProd = process.env.NODE_ENV === 'production';
    const sameSite = (process.env.COOKIE_SAMESITE?.toLowerCase() ??
      (isProd ? 'none' : 'lax')) as 'lax' | 'none' | 'strict';
    // A cookie with SameSite=None is rejected by browsers unless it is Secure.
    const secure = process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : isProd || sameSite === 'none';

    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    } as const;
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, this.cookieOptions());
  }
}
