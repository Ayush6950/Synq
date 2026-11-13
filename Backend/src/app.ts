import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './modules/auth/auth.routes.js';
import workspaceRoutes from './modules/workspaces/workspace.routes.js';
import inviteRoutes from './modules/invites/invite.routes.js';
import projectRoutes from './modules/projects/project.routes.js';
import boardRoutes from './modules/boards/board.routes.js';
import columnRoutes from './modules/columns/column.routes.js';
import taskRoutes from './modules/tasks/task.routes.js';

const app: Express = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// App Routes
app.use('/auth', authRoutes);
app.use('/workspaces', workspaceRoutes);
app.use('/invites', inviteRoutes);
app.use('/', projectRoutes);
app.use('/', boardRoutes);
app.use('/', columnRoutes);
app.use('/', taskRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Synq API is running');
});

export default app;
