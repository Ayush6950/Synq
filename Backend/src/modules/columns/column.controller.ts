import type { Request, Response } from 'express';
import prisma from '../../lib/prisma.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { generatePosition } from '../../lib/fractional.js';

/**
 * POST /boards/:boardId/columns
 * Add a new column to a board (placed at the end by default)
 */
export const createColumn = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const boardId = req.params.boardId as string;
    const { name, wipLimit, isDone = false } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Column name is required' });
      return;
    }

    // Find the current rightmost column position
    const lastCol = await prisma.boardColumn.findFirst({
      where: { boardId, archivedAt: null },
      orderBy: { position: 'desc' },
    });

    const newPosition = generatePosition(lastCol?.position, null);

    const column = await prisma.boardColumn.create({
      data: {
        boardId,
        name: name.trim(),
        position: newPosition,
        wipLimit: wipLimit ? Number(wipLimit) : null,
        isDone: Boolean(isDone),
      },
    });

    res.status(201).json({
      message: 'Column created successfully',
      column,
    });
  } catch (error) {
    console.error('Error in createColumn:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /columns/:id
 * Rename column or update WIP limits / isDone status
 */
export const updateColumn = async (req: Request, res: Response): Promise<void> => {
  try {
    const columnId = req.params.id as string;
    const { name, wipLimit, isDone } = req.body;

    const data: { name?: string; wipLimit?: number | null; isDone?: boolean } = {};
    if (name && typeof name === 'string') data.name = name.trim();
    if (wipLimit !== undefined) data.wipLimit = wipLimit === null ? null : Number(wipLimit);
    if (isDone !== undefined) data.isDone = Boolean(isDone);

    const updated = await prisma.boardColumn.update({
      where: { id: columnId },
      data,
    });

    res.status(200).json({
      message: 'Column updated successfully',
      column: updated,
    });
  } catch (error) {
    console.error('Error in updateColumn:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /columns/:id/move
 * Reorder column position using fractional indexing
 * Body: { prevPosition?: string, nextPosition?: string }
 */
export const moveColumn = async (req: Request, res: Response): Promise<void> => {
  try {
    const columnId = req.params.id as string;
    const { prevPosition, nextPosition } = req.body;

    const newPosition = generatePosition(prevPosition, nextPosition);

    const updated = await prisma.boardColumn.update({
      where: { id: columnId },
      data: { position: newPosition },
    });

    res.status(200).json({
      message: 'Column moved successfully',
      column: updated,
    });
  } catch (error) {
    console.error('Error in moveColumn:', error);
    res.status(500).json({ error: 'Internal server error moving column' });
  }
};

/**
 * DELETE /columns/:id
 * Archive (soft-delete) column
 */
export const archiveColumn = async (req: Request, res: Response): Promise<void> => {
  try {
    const columnId = req.params.id as string;

    await prisma.boardColumn.update({
      where: { id: columnId },
      data: { archivedAt: new Date() },
    });

    res.status(200).json({ message: 'Column archived successfully' });
  } catch (error) {
    console.error('Error in archiveColumn:', error);
    res.status(500).json({ error: 'Internal server error archiving column' });
  }
};
