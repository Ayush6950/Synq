import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import prisma from '../lib/prisma.js';

export type BoardRoleType = 'ADMIN' | 'EDITOR' | 'VIEWER';

const BOARD_ROLE_HIERARCHY: Record<BoardRoleType, number> = {
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

export interface BoardRequest extends AuthenticatedRequest {
  board?: {
    id: string;
    workspaceId: string;
    projectId: string;
    name: string;
    visibility: 'PRIVATE' | 'WORKSPACE';
  };
  boardRole?: BoardRoleType;
}

/**
 * Middleware to check board access and enforce minimum board role.
 *
 * Rules:
 * 1. Checks if board exists and is not archived.
 * 2. Checks user's workspace membership:
 *    - Workspace OWNER or ADMIN automatically gets board ADMIN privileges.
 * 3. If Board is PRIVATE:
 *    - User MUST be explicitly listed in BoardMember.
 * 4. If Board is WORKSPACE:
 *    - Workspace MEMBER gets default EDITOR role unless overridden in BoardMember.
 *    - Workspace GUEST MUST be explicitly listed in BoardMember (otherwise 403).
 */
export const requireBoardRole = (minRole: BoardRoleType = 'VIEWER') => {
  return async (req: BoardRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized: User not authenticated' });
        return;
      }

      const boardId =
        req.params.boardId ||
        req.params.id ||
        req.body?.boardId ||
        (req.query?.boardId as string);

      if (!boardId) {
        res.status(400).json({ error: 'Board ID is required' });
        return;
      }

      const board = await prisma.board.findUnique({
        where: { id: boardId },
        include: {
          members: {
            where: { userId: req.user.userId },
          },
        },
      });

      if (!board || board.archivedAt) {
        res.status(404).json({ error: 'Board not found' });
        return;
      }

      // Check workspace membership
      const wsMember = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: board.workspaceId,
            userId: req.user.userId,
          },
        },
      });

      if (!wsMember) {
        res.status(403).json({ error: 'Forbidden: You are not a member of this workspace' });
        return;
      }

      let effectiveRole: BoardRoleType | null = null;

      // Workspace OWNER and ADMIN always have full board ADMIN privileges
      if (wsMember.role === 'OWNER' || wsMember.role === 'ADMIN') {
        effectiveRole = 'ADMIN';
      } else {
        const explicitMember = board.members[0];

        if (explicitMember) {
          effectiveRole = explicitMember.role as BoardRoleType;
        } else if (board.visibility === 'WORKSPACE') {
          // Regular workspace members get EDITOR by default on WORKSPACE visible boards
          if (wsMember.role === 'MEMBER') {
            effectiveRole = 'EDITOR';
          }
          // GUESTS do not get automatic access to WORKSPACE boards unless added to BoardMember
        }
      }

      if (!effectiveRole) {
        res.status(403).json({ error: 'Forbidden: You do not have access to this board' });
        return;
      }

      const userWeight = BOARD_ROLE_HIERARCHY[effectiveRole] ?? 0;
      const requiredWeight = BOARD_ROLE_HIERARCHY[minRole];

      if (userWeight < requiredWeight) {
        res.status(403).json({
          error: `Forbidden: Requires at least board role '${minRole}' (your effective role is '${effectiveRole}')`,
        });
        return;
      }

      req.board = {
        id: board.id,
        workspaceId: board.workspaceId,
        projectId: board.projectId,
        name: board.name,
        visibility: board.visibility as 'PRIVATE' | 'WORKSPACE',
      };
      req.boardRole = effectiveRole;

      next();
    } catch (error) {
      console.error('Error in requireBoardRole:', error);
      res.status(500).json({ error: 'Internal server error during board authorization' });
    }
  };
};
