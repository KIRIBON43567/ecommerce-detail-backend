/**
 * D1 API 客户端 - 通过 Cloudflare Workers 访问 D1 数据库
 */

const WORKERS_API_URL = process.env.WORKERS_API_URL || 'https://ecommerce-detail-api.workers.dev';
const API_SECRET = process.env.WORKERS_API_SECRET || '';

interface RequestOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${WORKERS_API_URL}${path}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': API_SECRET,
    ...options.headers,
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((error as any).error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// ===== 用户操作 =====
export const users = {
  create: (data: { email: string; passwordHash: string; name?: string }) =>
    request<any>('/api/users', { method: 'POST', body: data }),
  
  login: (email: string) =>
    request<any>('/api/users/login', { method: 'POST', body: { email } }),
  
  getById: (id: number) =>
    request<any>(`/api/users/${id}`),
};

// ===== 项目操作 =====
export const projects = {
  list: (userId?: number) =>
    request<any[]>(`/api/projects${userId ? `?userId=${userId}` : ''}`),
  
  create: (data: { userId: number; productName: string; productDesc?: string; status?: string }) =>
    request<any>('/api/projects', { method: 'POST', body: data }),
  
  getById: (id: number) =>
    request<any>(`/api/projects/${id}`),
  
  update: (id: number, data: { productName?: string; productDesc?: string; status?: string }) =>
    request<any>(`/api/projects/${id}`, { method: 'PUT', body: data }),
  
  delete: (id: number) =>
    request<any>(`/api/projects/${id}`, { method: 'DELETE' }),
};

// ===== 图片操作 =====
export const images = {
  listByProject: (projectId: number) =>
    request<any[]>(`/api/projects/${projectId}/images`),
  
  create: (data: { projectId: number; sectionId?: number; type: string; r2Key: string; origFilename?: string }) =>
    request<any>('/api/images', { method: 'POST', body: data }),
  
  delete: (id: number) =>
    request<any>(`/api/images/${id}`, { method: 'DELETE' }),
};

// ===== 脚本段落操作 =====
export const sections = {
  listByProject: (projectId: number) =>
    request<any[]>(`/api/projects/${projectId}/sections`),
  
  create: (data: { projectId: number; orderIndex: number; title: string; subtitle?: string; description?: string; visualGuide?: string }) =>
    request<any>('/api/sections', { method: 'POST', body: data }),
  
  update: (id: number, data: { title?: string; subtitle?: string; description?: string; visualGuide?: string }) =>
    request<any>(`/api/sections/${id}`, { method: 'PUT', body: data }),
  
  delete: (id: number) =>
    request<any>(`/api/sections/${id}`, { method: 'DELETE' }),
  
  batchCreate: (projectId: number, sectionsData: Array<{ title: string; subtitle?: string; description?: string; visualGuide?: string }>) =>
    request<any[]>('/api/sections/batch', { method: 'POST', body: { projectId, sections: sectionsData } }),
};

// ===== 竞品文案操作 =====
export const competitorText = {
  listByProject: (projectId: number) =>
    request<any[]>(`/api/projects/${projectId}/competitor-text`),
  
  create: (data: { projectId: number; text: string; analysis?: string }) =>
    request<any>('/api/competitor-text', { method: 'POST', body: data }),
};

// ===== R2 存储操作 =====
export const storage = {
  getUrl: (key: string) => `${WORKERS_API_URL}/api/storage/${key}`,
  
  upload: async (key: string, file: Buffer | Uint8Array, contentType: string) => {
    const formData = new FormData();
    // 将 Buffer 转换为 Uint8Array 以确保类型兼容
    const uint8Array = file instanceof Uint8Array ? file : new Uint8Array(file);
    formData.append('file', new Blob([uint8Array], { type: contentType }), key);
    formData.append('key', key);
    
    const response = await fetch(`${WORKERS_API_URL}/api/storage/upload`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_SECRET,
      },
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    
    return response.json();
  },
  
  delete: (key: string) =>
    request<any>(`/api/storage/${key}`, { method: 'DELETE' }),
};

export default {
  users,
  projects,
  images,
  sections,
  competitorText,
  storage,
};
