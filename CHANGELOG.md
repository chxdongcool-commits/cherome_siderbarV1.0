# OpenClaw Sidebar 变更记录

## 2026-04-26 - 实现 WebSocket-based Gateway Pairing

### 问题
原 relay-server 使用 REST API (`/v1/claws/pair/request`) 进行配对，但 Gateway (v2026.4.8) 只支持 WebSocket-based pairing 流程，导致配对失败。

### 解决方案
实现符合 OpenClaw Gateway 协议的 WebSocket 配对流程。

### 代码变更

#### 1. relay-server/src/server/pairing.ts (重写)

**旧版实现** (REST-based):
- 使用 `POST /v1/claws/pair/request` 获取配对码
- 轮询 `GET /v1/claws/pair/status` 等待审批
- 该 API 在 Gateway 2026.4.8 上不存在

**新版实现** (WebSocket-based):
```
Flow:
1. 生成 Ed25519 设备密钥对
2. 连接 Gateway WebSocket
3. 发送 connect 请求 (role: "node", 携带设备公钥)
4. Gateway 返回 NOT_PAIRED (DEVICE_IDENTITY_REQUIRED)
5. 调用 node.pair.request 方法发起配对请求
6. Gateway 发送 node.pair.requested 事件
7. 管理员运行 openclaw nodes approve <requestId> 审批
8. Gateway 发送 node.pair.resolved 事件 (包含 token)
9. 保存 token 用于后续连接
```

**新增导出**:
- `loadOrCreateDeviceKey()`: 加载或生成设备密钥对
- `signData()`: 对配对数据进行签名
- `loadSavedToken()`: 加载已保存的设备 token

**存储位置**:
- 设备密钥: `~/.openclaw-relay/device-key.json`
- 设备 token: `~/.openclaw-relay/device-token`

#### 2. relay-server/src/server/websocket.ts (更新)

**变更**:
- 导入 `loadOrCreateDeviceKey` 和 `signData` from pairing.ts
- Connect 请求现在包含完整的设备身份:
  - `role: "node"`
  - `scopes: []`
  - `device.id`: 设备 ID (密钥指纹)
  - `device.publicKey`: 公钥
  - `device.signature`: 签名
  - `device.signedAt`: 签名时间戳
  - `device.nonce`: 随机数

#### 3. relay-server/src/main.ts (更新)

**变更**:
- 使用 `performPairingWebSocket` 替代 `performPairing`
- 优先使用已保存的 token (`~/.openclaw-relay/device-token`)
- 次优先: `DEVICE_TOKEN` 环境变量
- 最后: config 文件中的 token

### 部署后操作

1. **首次部署需要配对**:
   ```bash
   # 启动 relay
   docker run -d --network=host openclaw-relay

   # 在 gateway 服务器上查看待审批请求
   openclaw nodes list

   # 审批配对请求
   openclaw nodes approve <requestId>
   ```

2. **后续部署自动使用已保存 token**:
   - 设备密钥和 token 保存在 `~/.openclaw-relay/`
   - 重启 relay 时会自动使用已保存的 token

### 相关文档
- [OpenClaw Gateway Pairing](https://docs.openclaw.ai/gateway/pairing.md)
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol.md)
