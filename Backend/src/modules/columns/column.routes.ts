import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { requireBoardRole } from '../../middleware/boardRbac.js';
import {
  createColumn,
  updateColumn,
  moveColumn,
  archiveColumn,
} from './column.controller.js';

const router = Router();

router.use(authenticateToken);

// Adding a column to a board requires board ADMIN role
router.post('/boards/:boardId/columns', requireBoardRole('ADMIN'), createColumn);

// Direct column operations
router.patch('/columns/:id', updateColumn);
router.patch('/columns/:id/move', moveColumn);
router.delete('/columns/:id', archiveColumn);

export default router;
