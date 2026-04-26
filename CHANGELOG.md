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

---

## 2026-04-26 - Pairing 问题排查

### 发现的问题

经过多次尝试，发现以下问题：

1. **Gateway 要求设备身份**: 即使设置了 `dangerouslyDisableDeviceAuth: true`，Gateway 的 WebSocket 协议仍然要求设备身份验证。该设置只影响 Control UI。

2. **设备密钥格式**: Gateway 存储的设备公钥只有 40 字符（base64），而标准 Ed25519 公钥是 44 字符（base64）。这表明 Gateway 使用的是密钥指纹或哈希，而非实际的公钥。

3. **Device Identity Mismatch**: 生成新的 Ed25519 密钥对会导致 `DEVICE_AUTH_DEVICE_ID_MISMATCH` 错误，表明 Gateway 已经注册了特定设备的身份。

4. **node.pair.request 问题**: 调用 `node.pair.request` 方法后，Gateway 会立即关闭 WebSocket 连接，导致无法完成配对流程。

### 当前状态

- Docker 镜像: ✅ 构建成功
- Gateway 连接: ❌ 失败 (`DEVICE_AUTH_DEVICE_ID_MISMATCH`)

### 待解决

需要以下之一:
1. 提供预注册的设备身份给 relay 使用
2. 在 Gateway 服务器上手动添加 relay 的设备到 `~/.openclaw/devices/paired.json`
3. 确认 Gateway 版本是否支持 relay 类型的客户端连接

### 相关文档
- [OpenClaw Gateway Pairing](https://docs.openclaw.ai/gateway/pairing.md)
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol.md)
