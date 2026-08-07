# 接入说明与公开接口

Digital Human Studio 不内置任何个人 API Key、Token 或私人节点地址。接收项目的人只需要知道“要准备什么”，然后在自己的电脑上完成配置。

## 供应商接入

| 能力 | 供应商 | 级别 | 本机配置项 | 用途 |
| --- | --- | --- | --- | --- |
| 视频生成 | Seedance 2.0 | 必需 | `SEEDANCE_PYTHON`、`TOOL_VAULT_PATH`、`SEEDANCE_RUNNER` | 提交数字人口播成片任务 |
| 云端配音 | ElevenLabs | 推荐 | `ELEVENLABS_API_KEY` | 加载账号音色、生成配音试听 |
| 本地克隆音色 | Voicebox | 可选 | `VOICEBOX_URL` | 连接用户自己的本地语音服务 |

`SEEDANCE_MODEL` 是可选的视频模型标识。配置项只写入用户自己的 `.env` 或桌面应用数据目录，不应写进源码、截图、日志或 GitHub。

## 工作台公开 API

所有响应使用统一 JSON 信封：成功时返回 `ok: true`、`requestId` 和 `data`；失败时返回 `errorCode`、`message` 与 `retryable`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 服务和供应商健康状态 |
| `GET` | `/api/integrations` | 接入要求及脱敏后的配置/连接布尔状态 |
| `GET` | `/api/avatars` | 数字人目录 |
| `GET` | `/api/voices` | 音色目录 |
| `POST` | `/api/seedance/prompt-preview` | 生成可编辑的 Seedance 提示词 |
| `POST` | `/api/tasks` | 创建流程检查、配音或视频任务 |
| `GET` | `/api/tasks/{id}` | 轮询长任务状态 |

## 对接约定

- 外部供应商调用只发生在本机 Node.js 服务端，浏览器界面不接触密钥。
- 真实付费生成必须明确确认，失败不会自动付费重试。
- 长任务使用 `taskId` 轮询；重复提交由幂等键保护。
- `/api/integrations` 只返回配置项名称和布尔状态，绝不返回配置值或本机路径。
