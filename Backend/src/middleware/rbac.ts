import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import prisma from '../lib/prisma.js';

export type WorkspaceRoleType = 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';

const ROLE_HIERARCHY: Record<WorkspaceRoleType, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  GUEST: 1,
};

export interface WorkspaceRequest extends AuthenticatedRequest {
  workspaceMember?: {
    id: string;
    workspaceId: string;
    userId: string;
    role: WorkspaceRoleType;
  };
}

/**
 * Middleware to require a minimum workspace role
 * Hierarchy: OWNER > ADMIN > MEMBER > GUEST
 */
export const requireWorkspaceRole = (minRole: WorkspaceRoleType = 'GUEST') => {
  return async (req: WorkspaceRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized: User not authenticated' });
        return;
      }

      const workspaceId =
        req.params.workspaceId ||
        req.params.id ||
        req.body?.workspaceId ||
        (req.query?.workspaceId as string);

      if (!workspaceId) {
        res.status(400).json({ error: 'Workspace ID is required' });
        return;
      }

      const membership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: req.user.userId,
          },
        },
      });

      if (!membership) {
        res.status(403).json({ error: 'Forbidden: You are not a member of this workspace' });
        return;
      }

      const userRoleWeight = ROLE_HIERARCHY[membership.role as WorkspaceRoleType] ?? 0;
      const requiredRoleWeight = ROLE_HIERARCHY[minRole];

      if (userRoleWeight < requiredRoleWeight) {
        res.status(403).json({
          error: `Forbidden: Requires at least '${minRole}' role (your role: '${membership.role}')`,
        });
        return;
      }

      req.workspaceMember = {
        id: membership.id,
        workspaceId: membership.workspaceId,
        userId: membership.userId,
        role: membership.role as WorkspaceRoleType,
      };

      next();
    } catch (error) {
      console.error('Error in requireWorkspaceRole:', error);
      res.status(500).json({ error: 'Internal server error during authorization check' });
    }
  };
};
