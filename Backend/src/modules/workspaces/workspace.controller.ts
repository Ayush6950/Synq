import type { Response } from 'express';
import prisma from '../../lib/prisma.js';
import type { WorkspaceRequest } from '../../middleware/rbac.js';
import { hashToken, generateSecureRandomToken } from '../../lib/jwt.js';

/**
 * GET /workspaces
 * List all workspaces the authenticated user belongs to
 */
export const listMyWorkspaces = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            archivedAt: true,
            createdAt: true,
            _count: {
              select: {
                members: true,
                projects: true,
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const workspaces = (memberships as any[])
      .filter((m) => !m.workspace.archivedAt)
      .map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
        memberCount: m.workspace._count.members,
        projectCount: m.workspace._count.projects,
        createdAt: m.workspace.createdAt,
      }));

    res.status(200).json({ workspaces });
  } catch (error) {
    console.error('Error in listMyWorkspaces:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /workspaces
 * Create a new workspace and make the current user the OWNER
 */
export const createWorkspace = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { name, slug } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Workspace name is required' });
      return;
    }

    const cleanName = name.trim();
    const candidateSlug =
      slug?.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') ||
      cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const uniqueSlug = `${candidateSlug}-${Date.now().toString(36)}`;

    const workspace = await prisma.workspace.create({
      data: {
        name: cleanName,
        slug: uniqueSlug,
        createdById: userId,
        members: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
    });

    res.status(201).json({
      message: 'Workspace created successfully',
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role: 'OWNER',
        createdAt: workspace.createdAt,
      },
    });
  } catch (error) {
    console.error('Error in createWorkspace:', error);
    res.status(500).json({ error: 'Internal server error creating workspace' });
  }
};

/**
 * GET /workspaces/:id
 * Get details, projects, and member counts for a workspace
 */
export const getWorkspaceDetails = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id as string;

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        projects: {
          where: { archivedAt: null },
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
            createdAt: true,
            _count: {
              select: { boards: true, tasks: true },
            },
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!workspace || workspace.archivedAt) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const ws = workspace as any;

    res.status(200).json({
      workspace: {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        myRole: req.workspaceMember?.role,
        createdAt: ws.createdAt,
        projects: ws.projects,
        members: ws.members.map((m: any) => ({
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error in getWorkspaceDetails:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /workspaces/:id
 * Update workspace name or slug (Requires ADMIN or OWNER)
 */
export const updateWorkspace = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id as string;
    const { name, slug } = req.body;

    if (!name && !slug) {
      res.status(400).json({ error: 'At least name or slug must be provided' });
      return;
    }

    const data: { name?: string; slug?: string } = {};

    if (name && typeof name === 'string') {
      data.name = name.trim();
    }

    if (slug && typeof slug === 'string') {
      const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9]/g, '-');
      const existing = await prisma.workspace.findUnique({ where: { slug: cleanSlug } });
      if (existing && existing.id !== workspaceId) {
        res.status(409).json({ error: 'A workspace with this slug already exists' });
        return;
      }
      data.slug = cleanSlug;
    }

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });

    res.status(200).json({
      message: 'Workspace updated successfully',
      workspace: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
      },
    });
  } catch (error) {
    console.error('Error in updateWorkspace:', error);
    res.status(500).json({ error: 'Internal server error updating workspace' });
  }
};

/**
 * DELETE /workspaces/:id
 * Archive (soft-delete) workspace (Requires OWNER)
 */
export const archiveWorkspace = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id as string;

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { archivedAt: new Date() },
    });

    res.status(200).json({ message: 'Workspace archived successfully' });
  } catch (error) {
    console.error('Error in archiveWorkspace:', error);
    res.status(500).json({ error: 'Internal server error archiving workspace' });
  }
};

/**
 * GET /workspaces/:id/members
 * List all members of a workspace
 */
export const listMembers = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id as string;

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    res.status(200).json({
      members: (members as any[]).map((m: any) => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (error) {
    console.error('Error in listMembers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /workspaces/:id/members/:userId
 * Update a member's role (Requires ADMIN or OWNER)
 */
export const updateMemberRole = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const { role } = req.body;

    const validRoles = ['ADMIN', 'MEMBER', 'GUEST'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
      return;
    }

    const currentMember = req.workspaceMember!;

    const targetMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: targetUserId },
      },
    });

    if (!targetMember) {
      res.status(404).json({ error: 'Target member not found in this workspace' });
      return;
    }

    if (targetMember.role === 'OWNER') {
      res.status(403).json({ error: 'Cannot change the role of the workspace OWNER' });
      return;
    }

    if (
      (targetMember.role === 'ADMIN' || role === 'ADMIN') &&
      currentMember.role !== 'OWNER'
    ) {
      res.status(403).json({ error: 'Only workspace OWNER can assign or modify ADMIN roles' });
      return;
    }

    const updated = await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: { workspaceId, userId: targetUserId },
      },
      data: { role: role as any },
    });

    res.status(200).json({
      message: 'Member role updated successfully',
      member: {
        userId: updated.userId,
        role: updated.role,
      },
    });
  } catch (error) {
    console.error('Error in updateMemberRole:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * DELETE /workspaces/:id/members/:userId
 * Remove a member (or leave workspace)
 */
export const removeMember = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const currentMember = req.workspaceMember!;

    const targetMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: targetUserId },
      },
    });

    if (!targetMember) {
      res.status(404).json({ error: 'Member not found in this workspace' });
      return;
    }

    if (targetMember.role === 'OWNER') {
      res.status(403).json({ error: 'The workspace OWNER cannot be removed. Transfer ownership or archive workspace.' });
      return;
    }

    const isSelf = currentMember.userId === targetUserId;

    if (!isSelf && currentMember.role !== 'OWNER' && currentMember.role !== 'ADMIN') {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions to remove members' });
      return;
    }

    if (!isSelf && targetMember.role === 'ADMIN' && currentMember.role !== 'OWNER') {
      res.status(403).json({ error: 'Only the OWNER can remove an ADMIN' });
      return;
    }

    await prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId, userId: targetUserId },
      },
    });

    res.status(200).json({
      message: isSelf ? 'You have left the workspace' : 'Member removed successfully',
    });
  } catch (error) {
    console.error('Error in removeMember:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /workspaces/:id/invites
 * Create an email invitation to the workspace (Requires ADMIN or OWNER)
 */
export const createInvite = async (req: WorkspaceRequest, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.id as string;
    const inviterId = req.user!.userId;
    const { email, role = 'MEMBER' } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingMember = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        user: { email: normalizedEmail },
      },
    });

    if (existingMember) {
      res.status(409).json({ error: 'User is already a member of this workspace' });
      return;
    }

    const rawToken = generateSecureRandomToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.workspaceInvite.upsert({
      where: {
        workspaceId_email: { workspaceId, email: normalizedEmail },
      },
      update: {
        tokenHash,
        role: role as any,
        expiresAt,
        acceptedAt: null,
      },
      create: {
        workspaceId,
        email: normalizedEmail,
        role: role as any,
        tokenHash,
        invitedById: inviterId,
        expiresAt,
      },
    });

    const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invites/accept?token=${rawToken}`;
    console.log(`[INVITE] Invite link for ${normalizedEmail}: ${inviteLink}`);

    res.status(201).json({
      message: 'Invitation generated successfully',
      invite: {
        email: normalizedEmail,
        role,
        expiresAt,
        inviteLink,
      },
    });
  } catch (error) {
    console.error('Error in createInvite:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
