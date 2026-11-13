import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { requireWorkspaceRole } from '../../middleware/rbac.js';
import {
  listProjects,
  createProject,
  getProject,
  updateProject,
  archiveProject,
} from './project.controller.js';

const router = Router();

router.use(authenticateToken);

// Workspace-scoped project collection
router.get('/workspaces/:workspaceId/projects', requireWorkspaceRole('MEMBER'), listProjects);
router.post('/workspaces/:workspaceId/projects', requireWorkspaceRole('MEMBER'), createProject);

// Project entity routes
router.get('/projects/:id', getProject);
router.patch('/projects/:id', updateProject);
router.delete('/projects/:id', archiveProject);

export default router;
