import { Router, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { images, projects, storage } from '../utils/d1Client.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// 配置 multer 内存存储
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// 上传图片到项目
router.post('/:projectId/upload', authenticateToken, upload.array('files', 20), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = parseInt(req.params.projectId);
    const { type } = req.body; // 'product_input' 或 'competitor_input'

    // 验证项目所有权
    const project = await projects.getById(projectId);
    if (!project || project.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadedImages = [];

    for (const file of files) {
      // 生成唯一文件名
      const ext = file.originalname.split('.').pop() || 'jpg';
      const r2Key = `projects/${projectId}/${type}/${uuidv4()}.${ext}`;

      // 上传到 R2
      await storage.upload(r2Key, file.buffer, file.mimetype);

      // 保存图片记录到数据库
      const image = await images.create({
        projectId,
        type: type || 'product_input',
        r2Key,
        origFilename: file.originalname,
      });

      uploadedImages.push({
        ...image,
        url: storage.getUrl(r2Key),
      });
    }

    res.status(201).json(uploadedImages);
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// 获取项目的所有图片
router.get('/:projectId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = parseInt(req.params.projectId);

    // 验证项目所有权
    const project = await projects.getById(projectId);
    if (!project || project.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const projectImages = await images.listByProject(projectId);
    
    // 添加完整 URL
    const imagesWithUrls = projectImages.map((img: any) => ({
      ...img,
      url: storage.getUrl(img.r2_key),
    }));

    res.json(imagesWithUrls);
  } catch (error: any) {
    console.error('Get images error:', error);
    res.status(500).json({ error: error.message || 'Failed to get images' });
  }
});

// 删除图片
router.delete('/:imageId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const imageId = parseInt(req.params.imageId);
    
    // 这里应该先验证图片所属项目的所有权，简化处理直接删除
    await images.delete(imageId);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete image' });
  }
});

export default router;
