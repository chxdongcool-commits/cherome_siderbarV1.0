# OpenClaw Sidebar

Chrome Extension + Relay Server for real-time conversations with OpenClaw AI Agent.

**技术架构**：Chrome Extension (Side Panel) ↔ WSS ↔ Relay Server (Node.js) ↔ WS ↔ OpenClaw Gateway

---

## 项目结构

```
openclaw-sidebar/
├── .github/workflows/          # GitHub Actions CI/CD
├── extension/                  # Chrome Extension (Manifest V3)
│   ├── src/
│   │   ├── background/        # Service Worker
│   │   └── sidepanel/         # Side Panel UI (React)
│   └── public/icons/           # Extension icons
├── relay-server/               # Relay Server (Node.js)
│   └── src/
│       ├── main.ts            # Entry point
│       ├── config.ts          # Config loader
│       ├── logger.ts          # Pino logger
│       └── server/            # HTTP + WebSocket servers
├── shared/                    # Shared TypeScript types
│   └── src/index.ts
└── docs/                      # 项目文档
```

---

## 快速开始

### 前置要求

- Node.js >= 20.0.0
- npm >= 10.0.0
- Docker（用于 Relay Server 部署）

### 本地开发

```bash
# 安装依赖
npm ci

# 开发 Extension（Vite HMR）
npm run dev:ext

# 开发 Relay Server（auto-reload）
npm run dev:relay

# 类型检查
npm run typecheck

# 测试
npm test

# 构建所有项目
npm run build
```

### Extension 加载（Chrome）

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/dist`
5. 点击工具栏图标或按 `Alt+Shift+O` 打开侧边栏

---

## 部署

### 服务器要求

- Ubuntu / Alibaba Cloud Linux
- Docker + Docker Compose
- 开放端口 `18790`（WSS，对外）

### 部署步骤

```bash
# 1. 在阿里云安全组放行 18790 TCP

# 2. SSH 到服务器
ssh root@47.89.181.91

# 3. 创建部署目录
mkdir -p /opt/openclaw-relay
cd /opt/openclaw-relay

# 4. 编写 docker-compose.yml（自行配置）
# 5. 启动
docker-compose up -d

# 6. 查看日志
docker logs -f openclaw-relay
```

### GitHub Actions 自动部署

推送 tag 自动触发 CD：

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## CI/CD

### CI 流水线

- `npm run typecheck` — TypeScript 类型检查
- `npm run lint` — ESLint 代码规范
- `npm run test` — Vitest 单元测试
- `npm run build` — Vite + TypeScript 构建

### CD 流水线（Tag 触发）

1. 构建 Extension zip
2. 构建并推送 Docker 镜像到服务器
3. SSH 到服务器执行部署脚本

---

## 贡献规范

### 分支命名

```
feature/<功能名>
fix/<问题描述>
chore/<杂项>
```

### Commit 规范（Conventional Commits）

```
feat: 新功能
fix: 修复
refactor: 重构
docs: 文档
test: 测试
chore: 构建/依赖
```

### PR 要求

- 必须通过 CI（typecheck + lint + test）
- 至少 1 人 review
- 禁止泛泛而谈的 review 评论

---

## 相关文档

- [OpenClaw 官方文档](https://docs.openclaw.ai)
- [Chrome Extension 开发文档](https://developer.chrome.com/docs/extensions/develop)
- [技术文档](./docs/技术文档.md)
- [产品设计文档](./docs/产品设计文档.md)
- [部署配置文档](./docs/部署配置文档.md)
- [项目任务计划](./docs/项目任务计划.md)

---

## License

Private — All rights reserved.
