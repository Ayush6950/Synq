import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { requireWorkspaceRole } from '../../middleware/rbac.js';
import {
  listMyWorkspaces,
  createWorkspace,
  getWorkspaceDetails,
  updateWorkspace,
  archiveWorkspace,
  listMembers,
  updateMemberRole,
  removeMember,
  createInvite,
} from './workspace.controller.js';

const router = Router();

// All workspace routes require basic authentication
router.use(authenticateToken);

// 1. Workspace Collection
router.get('/', listMyWorkspaces);
router.post('/', createWorkspace);

// 2. Single Workspace (with RBAC)
router.get('/:id', requireWorkspaceRole('GUEST'), getWorkspaceDetails);
router.patch('/:id', requireWorkspaceRole('ADMIN'), updateWorkspace);
router.delete('/:id', requireWorkspaceRole('OWNER'), archiveWorkspace);

// 3. Members Management
router.get('/:id/members', requireWorkspaceRole('GUEST'), listMembers);
router.patch('/:id/members/:userId', requireWorkspaceRole('ADMIN'), updateMemberRole);
router.delete('/:id/members/:userId', requireWorkspaceRole('GUEST'), removeMember);

// 4. Invites
router.post('/:id/invites', requireWorkspaceRole('ADMIN'), createInvite);

export default router;
