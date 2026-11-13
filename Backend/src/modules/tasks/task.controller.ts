import type { Response } from 'express';
import prisma from '../../lib/prisma.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { generatePosition } from '../../lib/fractional.js';

/**
 * POST /columns/:columnId/tasks
 * Create a new task inside a column
 * Features:
 * - Increments Project.taskSeq atomically to generate project number (e.g. "SYN-42")
 * - Generates fractional position at the end of the column
 * - Denormalizes workspaceId, projectId, and boardId onto the task
 */
export const createTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const columnId = req.params.columnId as string;
    const userId = req.user!.userId;
    const { title, description, priority = 'NONE', dueDate, startDate } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Task title is required' });
      return;
    }

    const column = await prisma.boardColumn.findUnique({
      where: { id: columnId },
      include: {
        board: {
          select: { id: true, workspaceId: true, projectId: true },
        },
        tasks: {
          where: { archivedAt: null },
          orderBy: { position: 'desc' },
          take: 1,
        },
      },
    });

    if (!column || column.archivedAt) {
      res.status(404).json({ error: 'Column not found' });
      return;
    }

    const lastTask = column.tasks[0];
    const newPosition = generatePosition(lastTask?.position, null);

    // Atomic transaction: increment project sequence & create task
    const task = await prisma.$transaction(async (tx: any) => {
      const updatedProject = await tx.project.update({
        where: { id: column.board.projectId },
        data: { taskSeq: { increment: 1 } },
        select: { taskSeq: true, key: true },
      });

      const created = await tx.task.create({
        data: {
          workspaceId: column.board.workspaceId,
          projectId: column.board.projectId,
          boardId: column.board.id,
          columnId,
          number: updatedProject.taskSeq,
          title: title.trim(),
          description: description?.trim() || null,
          priority: priority as any,
          position: newPosition,
          startDate: startDate ? new Date(startDate) : null,
          dueDate: dueDate ? new Date(dueDate) : null,
          completedAt: column.isDone ? new Date() : null,
          createdById: userId,
        },
        include: {
          createdBy: { select: { id: true, name: true, avatarUrl: true } },
          column: { select: { id: true, name: true, isDone: true } },
        },
      });

      return { ...created, taskKey: `${updatedProject.key}-${created.number}` };
    });

    res.status(201).json({
      message: 'Task created successfully',
      task,
    });
  } catch (error) {
    console.error('Error in createTask:', error);
    res.status(500).json({ error: 'Internal server error creating task' });
  }
};

/**
 * GET /tasks/:id
 * Get task details including subtasks, comments, assignees, and labels
 */
export const getTaskDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: { select: { id: true, key: true, name: true } },
        column: { select: { id: true, name: true, isDone: true } },
        createdBy: { select: { id: true, name: true, avatarUrl: true } },
        assignees: {
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
        },
        labels: {
          include: { label: true },
        },
        subTasks: {
          where: { archivedAt: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            number: true,
            title: true,
            completedAt: true,
            priority: true,
          },
        },
        comments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!task || task.archivedAt) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.status(200).json({
      task: {
        ...task,
        taskKey: `${task.project.key}-${task.number}`,
      },
    });
  } catch (error) {
    console.error('Error in getTaskDetails:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /tasks/:id
 * Edit task details with Optimistic Concurrency Control (OCC)
 * If version is passed and doesn't match DB, returns 409 Conflict.
 */
export const updateTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    const { title, description, priority, dueDate, startDate, version } = req.body;

    const currentTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: { version: true },
    });

    if (!currentTask) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Optimistic Concurrency Check
    if (version !== undefined && Number(version) !== currentTask.version) {
      res.status(409).json({
        error: 'Conflict: This task has been modified by another teammate. Please refresh.',
        currentVersion: currentTask.version,
      });
      return;
    }

    const data: any = {
      version: { increment: 1 },
    };

    if (title && typeof title === 'string') data.title = title.trim();
    if (description !== undefined) data.description = description ? description.trim() : null;
    if (priority !== undefined) data.priority = priority;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;

    const updated = await prisma.task.update({
      where: { id: taskId },
      data,
    });

    res.status(200).json({
      message: 'Task updated successfully',
      task: updated,
    });
  } catch (error) {
    console.error('Error in updateTask:', error);
    res.status(500).json({ error: 'Internal server error updating task' });
  }
};

/**
 * PATCH /tasks/:id/move
 * Move card between columns and/or reorder position
 * Body: { targetColumnId?: string, prevPosition?: string, nextPosition?: string, version?: number }
 */
export const moveTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    const { targetColumnId, prevPosition, nextPosition, version } = req.body;

    const currentTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        column: { select: { id: true, isDone: true } },
      },
    });

    if (!currentTask || currentTask.archivedAt) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Optimistic Concurrency Check
    if (version !== undefined && Number(version) !== currentTask.version) {
      res.status(409).json({
        error: 'Conflict: This task was moved by another teammate. Please refresh.',
        currentVersion: currentTask.version,
      });
      return;
    }

    const newPosition = generatePosition(prevPosition, nextPosition);

    let completedAt = currentTask.completedAt;
    let newColumnId = currentTask.columnId;

    // Moving to a new column
    if (targetColumnId && targetColumnId !== currentTask.columnId) {
      const targetColumn = await prisma.boardColumn.findUnique({
        where: { id: targetColumnId },
      });

      if (!targetColumn) {
        res.status(404).json({ error: 'Target column not found' });
        return;
      }

      newColumnId = targetColumnId;
      completedAt = targetColumn.isDone ? new Date() : null;
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        columnId: newColumnId,
        position: newPosition,
        completedAt,
        version: { increment: 1 },
      },
      include: {
        column: { select: { id: true, name: true, isDone: true } },
      },
    });

    res.status(200).json({
      message: 'Task moved successfully',
      task: updated,
    });
  } catch (error) {
    console.error('Error in moveTask:', error);
    res.status(500).json({ error: 'Internal server error moving task' });
  }
};

/**
 * DELETE /tasks/:id
 * Archive (soft-delete) task
 */
export const archiveTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;

    await prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });

    res.status(200).json({ message: 'Task archived successfully' });
  } catch (error) {
    console.error('Error in archiveTask:', error);
    res.status(500).json({ error: 'Internal server error archiving task' });
  }
};

/**
 * POST /tasks/:id/restore
 * Restore an archived task
 */
export const restoreTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;

    const restored = await prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: null },
    });

    res.status(200).json({ message: 'Task restored successfully', task: restored });
  } catch (error) {
    console.error('Error in restoreTask:', error);
    res.status(500).json({ error: 'Internal server error restoring task' });
  }
};

/**
 * PUT /tasks/:id/assignees
 * Update assignees for a task (replace or set)
 * Body: { userIds: string[] }
 */
export const updateAssignees = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    const { userIds } = req.body;

    if (!Array.isArray(userIds)) {
      res.status(400).json({ error: 'userIds must be an array of user IDs' });
      return;
    }

    await prisma.$transaction([
      prisma.taskAssignee.deleteMany({ where: { taskId } }),
      prisma.taskAssignee.createMany({
        data: userIds.map((userId: string) => ({ taskId, userId })),
        skipDuplicates: true,
      }),
    ]);

    const assignees = await prisma.taskAssignee.findMany({
      where: { taskId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    res.status(200).json({ message: 'Assignees updated successfully', assignees });
  } catch (error) {
    console.error('Error in updateAssignees:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /tasks/:id/comments
 * Add comment to a task
 */
export const addComment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;
    const userId = req.user!.userId;
    const { content } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Comment content is required' });
      return;
    }

    const comment = await prisma.$transaction(async (tx: any) => {
      const created = await tx.comment.create({
        data: {
          taskId,
          authorId: userId,
          content: content.trim(),
        },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      });

      await tx.task.update({
        where: { id: taskId },
        data: { commentCount: { increment: 1 } },
      });

      return created;
    });

    res.status(201).json({ message: 'Comment added', comment });
  } catch (error) {
    console.error('Error in addComment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
