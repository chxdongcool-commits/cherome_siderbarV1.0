# OpenClaw Sidebar 变更记录

## 2026-04-27 - Phase 3 Extension 开发 🔄

### Extension 端口和协议修复

**问题**: Extension 配置的 Relay 连接地址错误

**修复内容**:

1. **端口修复**: `18790` → `18791`
   - manifest.json host_permissions
   - background/index.ts RELAY_URL

2. **协议修复**: `wss://` → `ws://`
   - Relay 服务 TLS 禁用，使用 ws 而非 wss
   - manifest.json CSP 配置

### Extension 构建验证

```
✓ built in 485ms
dist/src/sidepanel/index.html    0.36 kB
dist/assets/sidepanel.css        5.71 kB
dist/assets/sidepanel.js       313.28 kB
```

---

## 2026-04-27 - Gateway 配对问题已解决 ✅

### 问题修复

**根本原因**: 使用了错误的 token 类型
- Gateway token (`b5cd1af...`) 是设备级 token
- `node.pair.request` 需要 Operator 权限
- 需要使用 Operator token (`fSWST0Kz...`)

**修复内容**:

1. **pairing.ts** - 将 `auth.token` 改为 Operator token
   ```typescript
   auth: {
     token: 'fSWST0KzO4UPwwCfvsiObkHXeKCyiY2GLWueN7s0psU',  // Operator token
   }
   ```

2. **websocket.ts** - 将 `auth.deviceToken` 改为 `auth.token`
   ```typescript
   auth: {
     token: OPERATOR_TOKEN,  // 与 V2 签名中的 token 一致
   }
   ```

### 验证结果

```
[2026-04-27 00:16:08.140 +0800] INFO: Received hello-ok, Gateway handshake complete
    connId: "bebcbb02-8d73-4998-b462-2bee6221df06"
    methods: 121
[2026-04-27 00:16:08.141 +0800] INFO: Relay WebSocket server started
    port: 18791
```

### 相关文档

- [配对问题解决思路.md](./配对问题解决思路.md) - 详细修复方案
- [项目状态报告.md](./项目状态报告.md) - 项目状态更新
- [项目任务计划.md](./项目任务计划.md) - Phase 2 已完成

---

## 2026-04-26 - WebSocket Pairing 问题排查

### 问题描述

设备签名验证 (`DEVICE_AUTH_SIGNATURE_INVALID`) 问题。

**尝试过的方法**:
1. 使用 SPKI PEM 格式公钥 - 失败
2. 使用 Raw Base64 格式公钥 - 失败
3. 使用 Node.js crypto.sign 进行 Ed25519 签名 - 失败
4. 使用 role 'node' 和空 scopes - 失败
5. 使用 role 'operator' 和完整 scopes - 失败
6. 修复 nonce 使用 challenge.nonce - ✅ 已修复 nonce mismatch
7. 从 Gateway identity 文件加载密钥 - ✅ 已修复密钥加载
8. 移除 node.pair.request 的 role/scopes - ✅ 已修复参数格式
9. **使用 Operator token 替代 Gateway token** - ✅ **问题解决**

**详细分析**: [技术文档-配对流程.md](./技术文档-配对流程.md)

---

## 2026-04-26 - 创建项目状态报告

新建 [项目状态报告.md](./项目状态报告.md)，包含:
- 项目进度总览
- 当前阻塞问题
- 已完成功能清单
- 服务器部署状态
- CI/CD 状态
- 问题排查方法
- 下一步工作

---

## 2026-04-26 - 实现 WebSocket-based Gateway Pairing

  - `device.publicKey`: 公钥
  - `device.signature`: 签名
  - `device.signedAt`: 签名时间戳
  - `device.nonce`: 随机数

#### relay-server/src/main.ts (更新)

**变更**:
- 使用 `performPairingWebSocket` 替代 `performPairing`
- 优先使用已保存的 token (`~/.openclaw-relay/device-token`)
- 次优先: `DEVICE_TOKEN` 环境变量
- 最后: config 文件中的 token
