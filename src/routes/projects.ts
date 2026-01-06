import { Router, Response } from 'express';
import { projects, images, sections, competitorText } from '../utils/d1Client.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// 获取用户的所有项目
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectList = await projects.list(req.user.id);
    res.json(projectList);
  } catch (error: any) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: error.message || 'Failed to get projects' });
  }
});

// 创建新项目
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { productName, productDesc } = req.body;

    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    const project = await projects.create({
      userId: req.user.id,
      productName,
      productDesc,
      status: 'uploaded',
    });

    res.status(201).json(project);
  } catch (error: any) {
    console.error('Create project error:', error);
    res.status(500).json({ error: error.message || 'Failed to create project' });
  }
});

// 获取单个项目详情
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = parseInt(req.params.id);
    const project = await projects.getById(projectId);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // 验证项目所有权
    if (project.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 获取关联数据
    const [projectImages, projectSections, projectCompetitorText] = await Promise.all([
      images.listByProject(projectId),
      sections.listByProject(projectId),
      competitorText.listByProject(projectId),
    ]);

    res.json({
      ...project,
      images: projectImages,
      sections: projectSections,
      competitorText: projectCompetitorText,
    });
  } catch (error: any) {
    console.error('Get project error:', error);
    res.status(500).json({ error: error.message || 'Failed to get project' });
  }
});

// 更新项目
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = parseInt(req.params.id);
    const project = await projects.getById(projectId);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { productName, productDesc, status } = req.body;
    const updated = await projects.update(projectId, { productName, productDesc, status });

    res.json(updated);
  } catch (error: any) {
    console.error('Update project error:', error);
    res.status(500).json({ error: error.message || 'Failed to update project' });
  }
});

// 删除项目
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = parseInt(req.params.id);
    const project = await projects.getById(projectId);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await projects.delete(projectId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete project' });
  }
});

export default router;
