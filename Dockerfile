FROM node:20-alpine

WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 构建TypeScript
RUN npm run build

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["npm", "run", "start"]
