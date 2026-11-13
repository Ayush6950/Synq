import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface AuthUserPayload {
  userId: string;
  email: string;
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'synq_access_fallback_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'synq_refresh_fallback_secret';
const ACCESS_EXPIRES_IN = (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as `${number}${'m' | 'h' | 'd'}`;
const REFRESH_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as `${number}${'m' | 'h' | 'd'}`;

/**
 * Generate short-lived Access Token (JWT)
 */
export const generateAccessToken = (payload: AuthUserPayload): string => {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
};

/**
 * Generate long-lived Refresh Token (JWT)
 */
export const generateRefreshToken = (payload: AuthUserPayload): string => {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
};

/**
 * Verify Access Token
 */
export const verifyAccessToken = (token: string): AuthUserPayload => {
  return jwt.verify(token, ACCESS_SECRET) as AuthUserPayload;
};

/**
 * Verify Refresh Token
 */
export const verifyRefreshToken = (token: string): AuthUserPayload => {
  return jwt.verify(token, REFRESH_SECRET) as AuthUserPayload;
};

/**
 * Hash raw token (SHA-256) for secure storage in database
 */
export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Generate secure random token (e.g. for forgot password)
 */
export const generateSecureRandomToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};
