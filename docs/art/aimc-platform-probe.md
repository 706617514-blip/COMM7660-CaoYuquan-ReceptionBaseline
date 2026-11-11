# AIMC 平台接入探测记录（2026-11-11）

## 平台信息

- 地址：`http://158.182.35.42:3100/`
- 名称：AIM Film Studio · AIMC
- 描述：generate cinematic worlds with AI
- 状态：HTTP 200 可达

## 认证机制（实测）

```json
{"auth_required": true, "accounts_available": true, "signed_in": false,
 "sso_available": true, "sso_only": true, "password_login_available": false}
```

**只支持 SSO**，无密码登录。SSO 流程：

```
GET /api/auth/sso/start
  → 302 https://account.aim.ai4meta.net/sso/authorize?app=storylab&redirect_uri=...
  → set-cookie: studio_sso_state=<state>; HttpOnly; Max-Age=300
```

## 已知端点

| 端点 | 状态 | 说明 |
|---|---|---|
| `/api/auth/sso/start` | 302 | 启动 SSO |
| `/api/auth/sso/sync` | — | 同步会话 |
| `/api/auth/config` | 200 | 认证配置（见上） |
| `/api/auth/me` | 401 | 未登录时返回 `{"detail":"Please sign in"}` |
| `/api/user/self` | — | 当前用户 |
| `/create` | 200 | 创作页 |
| `/api/*`（其他） | 404 | FastAPI 默认响应 |

## 结论

生成能力**存在**，但需要人工在浏览器完成 SSO 登录。
Agent 无法也不应代为登录（需要账号凭据，且绕过认证违反课程材料使用规定）。

登录后的下一步：在已认证会话下探测生成 API（`/create` 页面会暴露实际调用）。
