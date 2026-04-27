# OpenClaw Sidebar Chrome Extension

> 本项目为 OpenClaw Sidebar Chrome Extension，通过 WebSocket 实现浏览器与 OpenClaw Gateway 的实时双向通信。

---

## 快速开始

### 1. 技术架构

```
Chrome Side Panel ←→ Service Worker ←→ Relay Server ←→ OpenClaw Gateway
     (18791)                       (18789)
```

### 2. 本地开发

```bash
# Extension 开发
cd extension
npm install
npm run dev      # 开发模式（热更新）

# Relay Server 开发
cd relay-server
npm install
npm run dev      # 开发模式（tsx watch）

# 构建生产版本
cd extension && npm run build
```

### 3. 加载 Extension 到 Chrome

1. 打开 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `extension/dist/` 目录

---

## 项目结构

```
cherome_siderbarV1.0/
├── extension/               # Chrome Extension
│   ├── src/
│   │   ├── background/       # Service Worker（WebSocket 连接管理）
│   │   └── sidepanel/       # Side Panel UI（React）
│   │       ├── App.tsx      # 主组件
│   │       ├── store.ts    # Zustand 状态管理
│   │       ├── storage.ts  # IndexedDB 存储
│   │       └── useStorage.ts # 存储同步
│   └── dist/               # 构建产物
│
├── relay-server/           # Node.js 中继服务
│   ├── src/
│   │   ├── main.ts         # 入口
│   │   ├── websocket.ts   # WebSocket 服务器
│   │   ├── relay.ts        # 消息路由
│   │   └── http.ts         # HTTP 接口
│   └── dist/               # 构建产物
│
├── shared/                 # 共享类型定义
│   └── src/index.ts
│
└── 项目任务计划.md          # 项目进度总览
```

---

## 关键文档

| 文档 | 说明 |
|------|------|
| [项目任务计划.md](./项目任务计划.md) | 项目整体进度、阶段任务、修复记录 |
| [技术文档.md](./技术文档.md) | 完整技术设计、协议定义、架构图 |
| [关于typing indicator的落地文档.md](./关于typing%20indicator的落地文档.md) | Typing Indicator 专项分析（待实现） |
| [README.md](./README.md) | 基本使用说明 |

---

## 核心流程

### Extension 连接流程

```
1. Extension 加载 → Service Worker 初始化
2. Service Worker 连接 Relay Server (ws://47.89.181.91:18791)
3. Relay Server 连接 Gateway (ws://127.0.0.1:18789) 并完成认证
4. Extension 订阅 sessions.subscribe + sessions.messages.subscribe
5. 用户发消息 → chat.send → Gateway → chat 事件 → 流式渲染
```

### 消息事件流

Gateway 发出的主要事件：
- `hello-ok` - 连接握手成功（含会话快照）
- `chat` - 消息事件（delta/final/error/aborted）
- `tick` - 心跳保活
- `health` - 健康检查

---

## 开发指南

### 添加新功能

1. 查看 `项目任务计划.md` 了解当前进度
2. 创建新分支：`git checkout -b feature/xxx`
3. 开发完成后提交 PR
4. 合并到 main 并部署

### 调试

**Service Worker 日志**：
- 打开 `chrome://extensions/`
- 找到 OpenClaw Sidebar
- 点击"Service Worker"链接

**Side Panel DevTools**：
- 右键点击扩展图标 → "审查弹出内容"

**Relay Server 日志**：
```bash
ssh root@47.89.181.91 "tail -f /tmp/relay.log"
```

---

## 服务器部署

| 服务 | 地址 | 端口 | 状态 |
|------|------|------|------|
| Gateway | 47.89.181.91 | 18789 | ✅ 运行中 |
| Relay | 47.89.181.91 | 18791 | ✅ 运行中 |
| HTTP | 47.89.181.91 | 8080 | ✅ 正常 |

**重启 Relay Server**：
```bash
ssh root@47.89.181.91
cd /root/relay-server-v2
pkill -f 'node main.js'
nohup node main.js > /tmp/relay.log 2>&1 &
```

---

## 已知问题

### Typing Indicator ⚠️

**状态**：代码已实现但功能不可用

**原因**：Gateway 不发 `typing.start/end` 事件。typing 是 Channel Layer 机制，Web Gateway 消费者无法直接使用。

**后续计划**：
- P1: Fallback 方案（chat delta 触发）
- P2: Relay 层模拟 typing signal
- P3: 考虑 Channel Layer 引入

详见 [项目任务计划.md](./项目任务计划.md#typing-indicator-专项分析)

---

## 技术栈

| 层级 | 技术 |
|------|------|
| Extension UI | React 18 + TypeScript + Vite |
| Extension 状态 | Zustand |
| Extension 存储 | IndexedDB |
| Markdown 渲染 | react-markdown + remark-gfm |
| Relay Server | Node.js 22 + ws + fastify |
| 日志 | pino + pino-pretty |
| WebSocket | ws |

---

## 相关链接

- [OpenClaw 官方文档](https://docs.openclaw.ai)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Chrome Extension 文档](https://developer.chrome.com/docs/extensions)
