import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../lib/prisma.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateSecureRandomToken,
} from '../../lib/jwt.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

const REFRESH_TOKEN_COOKIE_NAME = 'synq_refresh_token';
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Helper to set HTTP-only refresh token cookie
 */
const setRefreshTokenCookie = (res: Response, token: string) => {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
  });
};

/**
 * POST /auth/register
 * 1. Hash password with bcryptjs
 * 2. Create user in database
 * 3. Auto-create default personal workspace (role: OWNER)
 * 4. Issue JWT access & refresh tokens + session
 */
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Slug generation for workspace
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20) || 'workspace';
    const workspaceSlug = `${baseSlug}-${Date.now().toString(36)}`;

    // Atomic transaction: Create User, Default Workspace, and WorkspaceMember (OWNER)
    const result = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: name.trim(),
          passwordHash,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: `${user.name}'s Workspace`,
          slug: workspaceSlug,
          createdById: user.id,
          members: {
            create: {
              userId: user.id,
              role: 'OWNER',
            },
          },
        },
      });

      return { user, workspace };
    });

    // Generate tokens
    const tokenPayload = { userId: result.user.id, email: result.user.email };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Save hashed refresh token in Session table
    const tokenHashed = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS);

    await prisma.session.create({
      data: {
        userId: result.user.id,
        tokenHash: tokenHashed,
        userAgent: req.headers['user-agent'] || null,
        ip: req.ip || null,
        expiresAt,
      },
    });

    setRefreshTokenCookie(res, refreshToken);

    res.status(201).json({
      message: 'User registered successfully',
      accessToken,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        avatarUrl: result.user.avatarUrl,
        workspace: {
          id: result.workspace.id,
          name: result.workspace.name,
          slug: result.workspace.slug,
        },
      },
    });
  } catch (error) {
    console.error('Error in /auth/register:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
};

/**
 * POST /auth/login
 * 1. Verify email & password
 * 2. Store hashed refresh token in Session table
 * 3. Return { accessToken, user } and refresh token in cookie
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        memberships: {
          include: {
            workspace: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Generate tokens
    const tokenPayload = { userId: user.id, email: user.email };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Save session in DB
    const tokenHashed = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS);

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: tokenHashed,
        userAgent: req.headers['user-agent'] || null,
        ip: req.ip || null,
        expiresAt,
      },
    });

    setRefreshTokenCookie(res, refreshToken);

    res.status(200).json({
      message: 'Login successful',
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        workspaces: user.memberships.map((m: any) => ({
          id: m.workspace.id,
          name: m.workspace.name,
          slug: m.workspace.slug,
          role: m.role,
        })),
      },
    });
  } catch (error) {
    console.error('Error in /auth/login:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
};

/**
 * POST /auth/refresh
 * 1. Read refresh token from cookie or body
 * 2. Verify signature and check hashed token in Session table
 * 3. Token rotation: Revoke current session & create new session
 * 4. Issue new access token + new refresh token
 */
export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] || req.body?.refreshToken;

    if (!rawRefreshToken) {
      res.status(401).json({ error: 'Refresh token missing' });
      return;
    }

    let payload;
    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    const currentTokenHash = hashToken(rawRefreshToken);

    // Find active session
    const session = await prisma.session.findUnique({
      where: { tokenHash: currentTokenHash },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      res.status(401).json({ error: 'Session expired or revoked. Please log in again.' });
      return;
    }

    // Token Rotation: Generate new token pair
    const tokenPayload = { userId: payload.userId, email: payload.email };
    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);
    const newHashedToken = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS);

    // Transaction: Revoke old session and issue new session
    await prisma.$transaction([
      prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      prisma.session.create({
        data: {
          userId: payload.userId,
          tokenHash: newHashedToken,
          userAgent: req.headers['user-agent'] || null,
          ip: req.ip || null,
          expiresAt,
        },
      }),
    ]);

    setRefreshTokenCookie(res, newRefreshToken);

    res.status(200).json({
      accessToken: newAccessToken,
    });
  } catch (error) {
    console.error('Error in /auth/refresh:', error);
    res.status(500).json({ error: 'Internal server error during token refresh' });
  }
};

/**
 * POST /auth/logout
 * Invalidate session in database & clear cookie
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] || req.body?.refreshToken;

    if (rawRefreshToken) {
      const hashed = hashToken(rawRefreshToken);
      await prisma.session.updateMany({
        where: { tokenHash: hashed, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error in /auth/logout:', error);
    res.status(500).json({ error: 'Internal server error during logout' });
  }
};

/**
 * POST /auth/forgot-password
 * 1. Find user by email
 * 2. Generate cryptographically secure random token
 * 3. Store SHA-256 hash in PasswordResetToken table (15 min expiry)
 * 4. Respond with generic success message (prevents user enumeration)
 */
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user) {
      const resetToken = generateSecureRandomToken();
      const tokenHash = hashToken(resetToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      // In production with BullMQ:
      // await emailQueue.add('sendPasswordResetEmail', { email: user.email, token: resetToken });
      const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
      console.log(`[AUTH] Password reset link for ${user.email}: ${resetLink}`);
    }

    // Always respond with identical message to avoid account enumeration
    res.status(200).json({
      message: 'If an account exists with that email, a password reset link has been sent.',
    });
  } catch (error) {
    console.error('Error in /auth/forgot-password:', error);
    res.status(500).json({ error: 'Internal server error during forgot-password request' });
  }
};

/**
 * POST /auth/reset-password
 * 1. Lookup matching tokenHash in PasswordResetToken table
 * 2. Verify token is not expired and not used
 * 3. Hash new password & update User table
 * 4. Invalidate token and revoke all existing sessions (log out everywhere)
 */
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      res.status(400).json({ error: 'Token and new password are required' });
      return;
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    const tokenHashed = hashToken(token);

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: tokenHashed },
      include: { user: true },
    });

    if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt < new Date()) {
      res.status(400).json({ error: 'Invalid or expired password reset token' });
      return;
    }

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Atomic transaction: Update user password, mark token as used, and revoke all active sessions
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash: newPasswordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      // Revoke all sessions so previous logins cannot be hijacked
      prisma.session.updateMany({
        where: { userId: resetRecord.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
    res.status(200).json({
      message: 'Password reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    console.error('Error in /auth/reset-password:', error);
    res.status(500).json({ error: 'Internal server error during password reset' });
  }
};

/**
 * GET /auth/me
 * Returns current authenticated user and their active workspace memberships
 */
export const getMe = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('Error in /auth/me:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
