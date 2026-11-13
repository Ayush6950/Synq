import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { requireBoardRole } from '../../middleware/boardRbac.js';
import {
  listBoards,
  createBoard,
  getBoardSnapshot,
  updateBoard,
  archiveBoard,
} from './board.controller.js';

const router = Router();

router.use(authenticateToken);

// Project-level board collection
router.get('/projects/:projectId/boards', listBoards);
router.post('/projects/:projectId/boards', createBoard);

// Board entity routes (Guarded by requireBoardRole)
router.get('/boards/:id', requireBoardRole('VIEWER'), getBoardSnapshot);
router.patch('/boards/:id', requireBoardRole('ADMIN'), updateBoard);
router.delete('/boards/:id', requireBoardRole('ADMIN'), archiveBoard);

export default router;
