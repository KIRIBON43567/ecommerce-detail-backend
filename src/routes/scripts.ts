import { Router, Response } from 'express';
import OpenAI from 'openai';
import { projects, sections, competitorText, images, storage } from '../utils/d1Client.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// 配置 OpenAI 客户端使用 VectorEngine AI 服务
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.vectorengine.ai/v1',
});

// 文本生成模型配置
const TEXT_MODEL = process.env.TEXT_MODEL || 'gemini-2.5-flash';

// 生成图文脚本
router.post('/:projectId/generate', authenticateToken, async (req: AuthRequest, res: Response) => {
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
    await projects.update(projectId, { status: 'scripting' });

    // 获取竞品文案
    const competitorTexts = await competitorText.listByProject(projectId);
    const competitorInfo = competitorTexts.map((ct: any) => ct.text).join('\n\n');

    // 构建提示词
    const prompt = `你是一个专业的电商详情页文案策划师。请根据以下信息，为产品生成详情页图文脚本。

产品名称：${project.product_name}
产品描述：${project.product_desc || '无'}

竞品详情页文案参考：
${competitorInfo || '无竞品参考'}

请生成5-7张详情图的脚本，每张图包含：
1. 主标题（吸引眼球的卖点）
2. 副标题（补充说明）
3. 详细描述（产品特点、优势说明）
4. 视觉指导（建议的画面风格、场景、色调）

请以JSON格式输出，格式如下：
{
  "sections": [
    {
      "title": "主标题",
      "subtitle": "副标题",
      "description": "详细描述",
      "visualGuide": "视觉指导"
    }
  ]
}

注意：
1. 文案要有吸引力，突出产品卖点
2. 避免直接抄袭竞品文案，要有差异化
3. 视觉指导要具体，便于后续AI生成图片
4. 第一张图应该是主视觉+核心卖点
5. 最后一张图可以是购买引导或品牌信息`;

    // 调用 Gemini 模型
    const completion = await openai.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: '你是一个专业的电商详情页文案策划师，擅长撰写有吸引力的产品文案。请始终以JSON格式输出。' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    let scriptData;

    try {
      scriptData = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse AI response:', responseText);
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    if (!scriptData.sections || !Array.isArray(scriptData.sections)) {
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    // 批量保存脚本段落
    const savedSections = await sections.batchCreate(projectId, scriptData.sections);

    // 更新项目状态
    await projects.update(projectId, { status: 'scripted' });

    res.json({
      success: true,
      sections: savedSections,
    });
  } catch (error: any) {
    console.error('Generate script error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate script' });
  }
});

// 获取项目的脚本段落
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

    const projectSections = await sections.listByProject(projectId);
    res.json(projectSections);
  } catch (error: any) {
    console.error('Get sections error:', error);
    res.status(500).json({ error: error.message || 'Failed to get sections' });
  }
});

// 更新单个脚本段落
router.put('/section/:sectionId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const sectionId = parseInt(req.params.sectionId);
    const { title, subtitle, description, visualGuide } = req.body;

    const updated = await sections.update(sectionId, { title, subtitle, description, visualGuide });
    res.json(updated);
  } catch (error: any) {
    console.error('Update section error:', error);
    res.status(500).json({ error: error.message || 'Failed to update section' });
  }
});

// 重新生成单个脚本段落
router.post('/section/:sectionId/regenerate', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const sectionId = parseInt(req.params.sectionId);
    const { instruction } = req.body; // 用户的额外指示

    // 获取当前段落信息
    const projectSections = await sections.listByProject(parseInt(req.body.projectId));
    const currentSection = projectSections.find((s: any) => s.id === sectionId);

    if (!currentSection) {
      return res.status(404).json({ error: 'Section not found' });
    }

    const prompt = `请重新生成以下详情图脚本段落：

当前内容：
- 主标题：${currentSection.title}
- 副标题：${currentSection.subtitle}
- 描述：${currentSection.description}
- 视觉指导：${currentSection.visual_guide}

${instruction ? `用户要求：${instruction}` : '请生成一个更有吸引力的版本'}

请以JSON格式输出：
{
  "title": "新主标题",
  "subtitle": "新副标题",
  "description": "新描述",
  "visualGuide": "新视觉指导"
}`;

    const completion = await openai.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: '你是一个专业的电商详情页文案策划师。请始终以JSON格式输出。' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const newContent = JSON.parse(responseText);

    // 更新段落
    const updated = await sections.update(sectionId, {
      title: newContent.title,
      subtitle: newContent.subtitle,
      description: newContent.description,
      visualGuide: newContent.visualGuide,
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Regenerate section error:', error);
    res.status(500).json({ error: error.message || 'Failed to regenerate section' });
  }
});

// OCR 提取竞品文案（使用 Gemini Vision）
router.post('/:projectId/extract-text', authenticateToken, async (req: AuthRequest, res: Response) => {
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

    // 获取竞品图片
    const projectImages = await images.listByProject(projectId);
    const competitorImages = projectImages.filter((img: any) => img.type === 'competitor_input');

    if (competitorImages.length === 0) {
      return res.status(400).json({ error: 'No competitor images found' });
    }

    // 使用 Gemini Vision 分析图片
    const extractedTexts = [];

    for (const img of competitorImages) {
      const imageUrl = storage.getUrl(img.r2_key);
      
      // 调用 Gemini Vision 分析图片
      try {
        const response = await openai.chat.completions.create({
          model: TEXT_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: '请分析这张电商详情页图片，提取其中的文字内容和主要卖点。以JSON格式输出：{"text": "提取的文字", "keyPoints": ["卖点1", "卖点2"]}',
                },
                {
                  type: 'image_url',
                  image_url: { url: imageUrl },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1000,
        });

        const result = JSON.parse(response.choices[0]?.message?.content || '{}');
        
        // 保存提取的文案
        const saved = await competitorText.create({
          projectId,
          text: result.text || '',
          analysis: JSON.stringify(result.keyPoints || []),
        });

        extractedTexts.push(saved);
      } catch (e) {
        console.error('Failed to analyze image:', e);
      }
    }

    res.json({
      success: true,
      extractedTexts,
    });
  } catch (error: any) {
    console.error('Extract text error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract text' });
  }
});

export default router;
