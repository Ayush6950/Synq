import type { Response } from 'express';
import prisma from '../../lib/prisma.js';
import type { BoardRequest } from '../../middleware/boardRbac.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { generatePosition } from '../../lib/fractional.js';

/**
 * GET /projects/:projectId/boards
 * List all accessible boards in a project
 */
export const listBoards = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.user!.userId;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const wsMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: project.workspaceId, userId },
      },
    });

    if (!wsMember) {
      res.status(403).json({ error: 'Forbidden: You are not a member of this workspace' });
      return;
    }

    const isWsAdmin = wsMember.role === 'OWNER' || wsMember.role === 'ADMIN';

    const boards = await prisma.board.findMany({
      where: {
        projectId,
        archivedAt: null,
        ...(isWsAdmin
          ? {}
          : wsMember.role === 'MEMBER'
          ? {
              OR: [
                { visibility: 'WORKSPACE' },
                { members: { some: { userId } } },
              ],
            }
          : {
              // GUESTS only see boards where they are explicit members
              members: { some: { userId } },
            }),
      },
      orderBy: { position: 'asc' },
      include: {
        _count: {
          select: { columns: true, tasks: true, members: true },
        },
      },
    });

    res.status(200).json({ boards });
  } catch (error) {
    console.error('Error in listBoards:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /projects/:projectId/boards
 * Create a new board with default starter columns (To Do, In Progress, Done)
 */
export const createBoard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.user!.userId;
    const { name, visibility = 'WORKSPACE' } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Board name is required' });
      return;
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        boards: {
          where: { archivedAt: null },
          orderBy: { position: 'desc' },
          take: 1,
        },
      },
    });

    if (!project || project.archivedAt) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const lastBoard = project.boards[0];
    const newPosition = generatePosition(lastBoard?.position, null);

    // Initial starter column positions
    const pos1 = generatePosition(null, null); // "a0"
    const pos2 = generatePosition(pos1, null);  // "a1"
    const pos3 = generatePosition(pos2, null);  // "a2"

    const result = await prisma.$transaction(async (tx: any) => {
      const board = await tx.board.create({
        data: {
          workspaceId: project.workspaceId,
          projectId,
          name: name.trim(),
          visibility: visibility === 'PRIVATE' ? 'PRIVATE' : 'WORKSPACE',
          position: newPosition,
          createdById: userId,
          members: {
            create: {
              userId,
              role: 'ADMIN',
            },
          },
          columns: {
            create: [
              { name: 'To Do', position: pos1, isDone: false },
              { name: 'In Progress', position: pos2, isDone: false },
              { name: 'Done', position: pos3, isDone: true },
            ],
          },
        },
        include: {
          columns: { orderBy: { position: 'asc' } },
        },
      });

      return board;
    });

    res.status(201).json({
      message: 'Board created successfully with default columns',
      board: result,
    });
  } catch (error) {
    console.error('Error in createBoard:', error);
    res.status(500).json({ error: 'Internal server error creating board' });
  }
};

/**
 * GET /boards/:id
 * Full snapshot: Board details, Columns, and Ordered Active Tasks with Assignees & Labels
 */
export const getBoardSnapshot = async (req: BoardRequest, res: Response): Promise<void> => {
  try {
    const boardId = req.params.id as string;

    const board = await prisma.board.findUnique({
      where: { id: boardId },
      include: {
        project: {
          select: { id: true, key: true, name: true },
        },
        columns: {
          where: { archivedAt: null },
          orderBy: { position: 'asc' },
          include: {
            tasks: {
              where: { archivedAt: null },
              orderBy: { position: 'asc' },
              include: {
                assignees: {
                  include: {
                    user: {
                      select: { id: true, name: true, avatarUrl: true },
                    },
                  },
                },
                labels: {
                  include: { label: true },
                },
                _count: {
                  select: { comments: true, attachments: true, subTasks: true },
                },
              },
            },
          },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
          },
        },
      },
    });

    if (!board || board.archivedAt) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    res.status(200).json({
      board,
      myEffectiveRole: req.boardRole,
    });
  } catch (error) {
    console.error('Error in getBoardSnapshot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /boards/:id
 * Update board name, visibility, or reorder board position
 */
export const updateBoard = async (req: BoardRequest, res: Response): Promise<void> => {
  try {
    const boardId = req.params.id as string;
    const { name, visibility, position } = req.body;

    const data: { name?: string; visibility?: any; position?: string } = {};
    if (name && typeof name === 'string') data.name = name.trim();
    if (visibility === 'PRIVATE' || visibility === 'WORKSPACE') data.visibility = visibility;
    if (position && typeof position === 'string') data.position = position;

    const updated = await prisma.board.update({
      where: { id: boardId },
      data,
    });

    res.status(200).json({
      message: 'Board updated successfully',
      board: updated,
    });
  } catch (error) {
    console.error('Error in updateBoard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * DELETE /boards/:id
 * Soft delete (archive) board
 */
export const archiveBoard = async (req: BoardRequest, res: Response): Promise<void> => {
  try {
    const boardId = req.params.id as string;

    await prisma.board.update({
      where: { id: boardId },
      data: { archivedAt: new Date() },
    });

    res.status(200).json({ message: 'Board archived successfully' });
  } catch (error) {
    console.error('Error in archiveBoard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
