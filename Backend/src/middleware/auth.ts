import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type AuthUserPayload } from '../lib/jwt.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthUserPayload;
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Access token missing or malformed' });
    return;
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired. Please refresh your token.' });
      return;
    }
    res.status(403).json({ error: 'Forbidden: Invalid access token' });
  }
};
