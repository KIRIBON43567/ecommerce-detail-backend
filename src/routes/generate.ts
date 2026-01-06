import { Router, Response } from 'express';
import OpenAI from 'openai';
import archiver from 'archiver';
import { projects, sections, images, storage } from '../utils/d1Client.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 批量生成详情图
router.post('/:projectId/images', authenticateToken, async (req: AuthRequest, res: Response) => {
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

    // 更新项目状态
    await projects.update(projectId, { status: 'generating' });

    // 获取脚本段落
    const projectSections = await sections.listByProject(projectId);

    if (projectSections.length === 0) {
      return res.status(400).json({ error: 'No script sections found. Please generate script first.' });
    }

    const generatedImages = [];

    // 为每个段落生成图片
    for (const section of projectSections) {
      try {
        // 构建图像生成提示词
        const imagePrompt = `电商产品详情页设计图，专业商业摄影风格。
产品：${project.product_name}
主题：${section.title}
副标题：${section.subtitle || ''}
视觉要求：${section.visual_guide || '现代简约风格，高端质感'}

要求：
- 专业的电商详情页布局
- 清晰的产品展示区域
- 预留文字排版空间
- 高品质商业摄影风格
- 背景干净，突出产品`;

        // 调用 DALL-E 生成图片
        const response = await openai.images.generate({
          model: 'dall-e-3',
          prompt: imagePrompt,
          n: 1,
          size: '1024x1792', // 竖版详情图尺寸
          quality: 'standard',
        });

        const imageUrl = response.data[0]?.url;

        if (imageUrl) {
          // 下载图片并上传到 R2
          const imageResponse = await fetch(imageUrl);
          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

          const r2Key = `projects/${projectId}/generated/${section.id}_${Date.now()}.png`;
          await storage.upload(r2Key, imageBuffer, 'image/png');

          // 保存图片记录
          const savedImage = await images.create({
            projectId,
            sectionId: section.id,
            type: 'generated_output',
            r2Key,
            origFilename: `section_${section.order_index + 1}.png`,
          });

          generatedImages.push({
            ...savedImage,
            url: storage.getUrl(r2Key),
            section,
          });
        }
      } catch (e: any) {
        console.error(`Failed to generate image for section ${section.id}:`, e);
        // 继续处理其他段落
      }
    }

    // 更新项目状态
    await projects.update(projectId, { status: 'generated' });

    res.json({
      success: true,
      images: generatedImages,
    });
  } catch (error: any) {
    console.error('Generate images error:', error);
    // 恢复项目状态
    try {
      await projects.update(parseInt(req.params.projectId), { status: 'scripted' });
    } catch (e) {}
    res.status(500).json({ error: error.message || 'Failed to generate images' });
  }
});

// 重新生成单张图片
router.post('/regenerate/:imageId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const imageId = parseInt(req.params.imageId);
    const { instruction, target } = req.body; // target: 'background' | 'full'

    // 获取图片信息
    // 这里简化处理，实际需要先获取图片关联的项目和段落信息
    const { projectId, sectionId } = req.body;

    const project = await projects.getById(projectId);
    if (!project || project.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const projectSections = await sections.listByProject(projectId);
    const section = projectSections.find((s: any) => s.id === sectionId);

    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    // 构建新的提示词
    let imagePrompt = `电商产品详情页设计图，专业商业摄影风格。
产品：${project.product_name}
主题：${section.title}
副标题：${section.subtitle || ''}
视觉要求：${section.visual_guide || '现代简约风格，高端质感'}`;

    if (instruction) {
      imagePrompt += `\n\n特别要求：${instruction}`;
    }

    if (target === 'background') {
      imagePrompt += '\n\n重点：生成不同的背景风格，保持产品展示区域一致';
    }

    // 生成新图片
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: imagePrompt,
      n: 1,
      size: '1024x1792',
      quality: 'standard',
    });

    const imageUrl = response.data[0]?.url;

    if (!imageUrl) {
      return res.status(500).json({ error: 'Failed to generate image' });
    }

    // 下载并上传到 R2
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    const r2Key = `projects/${projectId}/generated/${sectionId}_${Date.now()}.png`;
    await storage.upload(r2Key, imageBuffer, 'image/png');

    // 删除旧图片
    await images.delete(imageId);

    // 保存新图片记录
    const savedImage = await images.create({
      projectId,
      sectionId,
      type: 'generated_output',
      r2Key,
      origFilename: `section_${section.order_index + 1}_regenerated.png`,
    });

    res.json({
      success: true,
      image: {
        ...savedImage,
        url: storage.getUrl(r2Key),
      },
    });
  } catch (error: any) {
    console.error('Regenerate image error:', error);
    res.status(500).json({ error: error.message || 'Failed to regenerate image' });
  }
});

// 打包下载所有详情图
router.get('/:projectId/download', authenticateToken, async (req: AuthRequest, res: Response) => {
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

    // 获取所有生成的图片
    const projectImages = await images.listByProject(projectId);
    const generatedImages = projectImages.filter((img: any) => img.type === 'generated_output');

    if (generatedImages.length === 0) {
      return res.status(400).json({ error: 'No generated images found' });
    }

    // 设置响应头
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${project.product_name}_details.zip"`);

    // 创建 ZIP 压缩流
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // 添加图片到压缩包
    for (let i = 0; i < generatedImages.length; i++) {
      const img = generatedImages[i];
      const imageUrl = storage.getUrl(img.r2_key);

      try {
        // 下载图片
        const response = await fetch(imageUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        // 添加到压缩包
        archive.append(buffer, { name: `detail_${i + 1}.png` });
      } catch (e) {
        console.error(`Failed to add image ${img.id} to archive:`, e);
      }
    }

    // 添加脚本文案文件
    const projectSections = await sections.listByProject(projectId);
    let scriptContent = `# ${project.product_name} - 详情页文案\n\n`;

    projectSections.forEach((section: any, index: number) => {
      scriptContent += `## 第${index + 1}张图\n\n`;
      scriptContent += `**主标题：** ${section.title}\n\n`;
      scriptContent += `**副标题：** ${section.subtitle || ''}\n\n`;
      scriptContent += `**描述：** ${section.description || ''}\n\n`;
      scriptContent += `---\n\n`;
    });

    archive.append(scriptContent, { name: 'script.md' });

    // 完成压缩
    await archive.finalize();

    // 更新项目状态
    await projects.update(projectId, { status: 'completed' });
  } catch (error: any) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message || 'Failed to create download' });
  }
});

export default router;
