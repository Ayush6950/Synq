import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { acceptInvite } from './invite.controller.js';

const router = Router();

router.post('/accept', authenticateToken, acceptInvite);

export default router;
