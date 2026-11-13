import type { Response } from 'express';
import prisma from '../../lib/prisma.js';
import { hashToken } from '../../lib/jwt.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * POST /invites/accept
 * Accept an invite token and join the workspace
 */
export const acceptInvite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Invite token is required' });
      return;
    }

    const tokenHashed = hashToken(token);

    const invite = await prisma.workspaceInvite.findUnique({
      where: { tokenHash: tokenHashed },
      include: { workspace: true },
    });

    if (!invite || invite.expiresAt < new Date()) {
      res.status(400).json({ error: 'Invalid or expired invitation token' });
      return;
    }

    if (invite.acceptedAt) {
      res.status(400).json({ error: 'This invitation has already been accepted' });
      return;
    }

    // Check if user is already a member
    const existing = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: invite.workspaceId,
          userId,
        },
      },
    });

    if (existing) {
      // Mark invite accepted anyway
      await prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      res.status(200).json({
        message: 'You are already a member of this workspace',
        workspace: {
          id: invite.workspace.id,
          name: invite.workspace.name,
          slug: invite.workspace.slug,
        },
      });
      return;
    }

    // Add member & mark invite accepted atomically
    await prisma.$transaction([
      prisma.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId,
          role: invite.role,
        },
      }),
      prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    res.status(200).json({
      message: `Successfully joined ${invite.workspace.name}`,
      workspace: {
        id: invite.workspace.id,
        name: invite.workspace.name,
        slug: invite.workspace.slug,
        role: invite.role,
      },
    });
  } catch (error) {
    console.error('Error in acceptInvite:', error);
    res.status(500).json({ error: 'Internal server error accepting invitation' });
  }
};
