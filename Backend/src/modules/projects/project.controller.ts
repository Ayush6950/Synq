import type { Response } from 'express';
import prisma from '../../lib/prisma.js';
import type { WorkspaceRequest } from '../../middleware/rbac.js';

/**
 * GET /workspaces/:workspaceId/projects
 * List all active projects in a workspace
 */
export const listProjects = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;

    const projects = await prisma.project.findMany({
      where: {
        workspaceId,
        archivedAt: null,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true },
        },
        _count: {
          select: {
            boards: true,
            tasks: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      projects: (projects as any[]).map((p: any) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
        taskCount: p._count.tasks,
        boardCount: p._count.boards,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error in listProjects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /workspaces/:workspaceId/projects
 * Create a new project (Requires MEMBER, ADMIN, or OWNER)
 */
export const createProject = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = req.user!.userId;
    const { name, key, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    if (!key || typeof key !== 'string' || !key.trim()) {
      res.status(400).json({ error: 'Project key is required (e.g. "SYN", "WEB")' });
      return;
    }

    const cleanKey = key.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(cleanKey)) {
      res.status(400).json({ error: 'Project key must be 2-10 alphanumeric characters (e.g. SYN, WEB)' });
      return;
    }

    // Check if key is already taken in this workspace
    const existing = await prisma.project.findUnique({
      where: {
        workspaceId_key: { workspaceId, key: cleanKey },
      },
    });

    if (existing) {
      res.status(409).json({ error: `A project with key '${cleanKey}' already exists in this workspace` });
      return;
    }

    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: name.trim(),
        key: cleanKey,
        description: description?.trim() || null,
        createdById: userId,
      },
    });

    res.status(201).json({
      message: 'Project created successfully',
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
      },
    });
  } catch (error) {
    console.error('Error in createProject:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /projects/:id
 * Get single project details with boards
 */
export const getProject = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        boards: {
          where: { archivedAt: null },
          select: {
            id: true,
            name: true,
            visibility: true,
            position: true,
            createdAt: true,
            _count: { select: { columns: true, tasks: true } },
          },
          orderBy: { position: 'asc' },
        },
        createdBy: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    if (!project || project.archivedAt) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.status(200).json({ project });
  } catch (error) {
    console.error('Error in getProject:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /projects/:id
 * Update project name or description (Requires ADMIN or OWNER)
 */
export const updateProject = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const { name, description } = req.body;

    const data: { name?: string; description?: string } = {};
    if (name && typeof name === 'string') data.name = name.trim();
    if (description !== undefined) data.description = description ? description.trim() : null;

    const updated = await prisma.project.update({
      where: { id: projectId },
      data,
    });

    res.status(200).json({
      message: 'Project updated successfully',
      project: updated,
    });
  } catch (error) {
    console.error('Error in updateProject:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * DELETE /projects/:id
 * Soft delete (archive) project (Requires ADMIN or OWNER)
 */
export const archiveProject = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;

    await prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date() },
    });

    res.status(200).json({ message: 'Project archived successfully' });
  } catch (error) {
    console.error('Error in archiveProject:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
