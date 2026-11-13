import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import {
  createTask,
  getTaskDetails,
  updateTask,
  moveTask,
  archiveTask,
  restoreTask,
  updateAssignees,
  addComment,
} from './task.controller.js';

const router = Router();

router.use(authenticateToken);

// Create task inside a column
router.post('/columns/:columnId/tasks', createTask);

// Task operations
router.get('/tasks/:id', getTaskDetails);
router.patch('/tasks/:id', updateTask);
router.patch('/tasks/:id/move', moveTask);
router.delete('/tasks/:id', archiveTask);
router.post('/tasks/:id/restore', restoreTask);

// Task collaboration
router.put('/tasks/:id/assignees', updateAssignees);
router.post('/tasks/:id/comments', addComment);

export default router;
