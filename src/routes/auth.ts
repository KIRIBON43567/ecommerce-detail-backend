import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { users } from '../utils/d1Client.js';
import { generateToken, authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// 注册
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // 检查用户是否已存在
    try {
      const existingUser = await users.login(email);
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists' });
      }
    } catch (e) {
      // 用户不存在，继续注册
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 创建用户
    const user = await users.create({ email, passwordHash, name });

    // 生成 token
    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'user',
    });

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      token,
    });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

// 登录
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // 获取用户
    const user = await users.login(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 生成 token
    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'user',
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      token,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

// 获取当前用户信息
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await users.getById(req.user.id);
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: error.message || 'Failed to get user' });
  }
});

export default router;
