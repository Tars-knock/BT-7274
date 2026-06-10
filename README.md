# BT-7274

面向 AI Agent 工作流的本地文档评审台。

BT-7274 让 Agent 生成的 Markdown 或 HTML 不再只能停留在聊天窗口里反复粘贴修改。Agent 可以把文档发布到一个本地浏览器评审页，用户在页面里预览、标注、提交意见或直接通过，Agent 再根据结构化反馈继续修改，直到最终版本被确认。

它适合用来评审实现方案、PR 描述、产品文档、技术设计、发布说明、报告草稿，以及任何需要“人类最终把关”的 AI 生成文档。

## 为什么需要它

AI 擅长快速产出草稿，但文档验收通常需要更清楚的上下文：

- 在浏览器里看最终排版，而不是在终端或聊天气泡里猜效果
- 对具体文本片段提出修改、提问或讨论，而不是写“第三段有问题”
- 修改意见可以批量提交，提问和讨论会立即通知 Agent
- 保留版本历史和 diff，确认 Agent 是否真的改对了
- 通过明确的“评审通过”结束流程，避免口头确认丢失

BT-7274 把这些步骤做成本地 MCP 工具和浏览器界面，既保留 Agent 自动化能力，也让用户拥有清晰的评审控制权。

## 产品体验

- **文档预览**：支持 Markdown 和 HTML，Markdown 使用 `markdown-it` 渲染，HTML 会移除脚本并在沙箱中预览。
- **目录导航**：自动提取标题，长文档可以快速跳转。
- **划词反馈**：选中文本即可选择 `要求修改`、`提问` 或 `讨论`，反馈会携带引用、上下文和文本位置。
- **批量提交**：草稿评论可以集中提交给 Agent，并附带整体反馈。
- **即时讨论**：提问和讨论会创建内联线程，Agent 可以直接回复，不必发布新文档版本。
- **版本迭代**：Agent 更新文档后，同一个评审页会展示新版本。
- **Diff 与历史**：查看上一版和当前版的差异，追踪每轮修改。
- **明确批准**：点击 `评审通过` 后，Agent 会收到已批准的最终内容。
- **本地优先**：服务运行在本机，评审会话持久化到项目目录下的 `.bt-7274/sessions`。

## 快速开始

要求：

- Node.js 20 或更新版本
- 支持 MCP stdio server 的客户端

通过 GitHub 源直接运行：

```bash
npx -y github:Tars-knock/BT-7274
```

默认评审界面地址：

```text
http://127.0.0.1:8787
```

如需指定监听地址、端口或对外展示的基础 URL：

```bash
REVIEW_MCP_HOST=127.0.0.1 \
REVIEW_MCP_PORT=8787 \
REVIEW_MCP_BASE_URL=http://127.0.0.1:8787 \
npx -y github:Tars-knock/BT-7274
```

本地开发：

```bash
npm install
npm start
```

## 接入 MCP 客户端

通用 MCP 配置：

```json
{
  "mcpServers": {
    "bt-7274": {
      "command": "npx",
      "args": ["-y", "github:Tars-knock/BT-7274"]
    }
  }
}
```

opencode 配置：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bt-7274": {
      "type": "local",
      "command": ["npx", "-y", "github:Tars-knock/BT-7274"],
      "enabled": true
    }
  }
}
```

从克隆仓库运行时，可以直接指向本地入口：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bt-7274": {
      "type": "local",
      "command": ["node", "/home/tars/projects/BT-7274/src/server.js"],
      "enabled": true
    }
  }
}
```

## 工作流

1. Agent 调用 `create_review_session`，提交标题、格式和文档内容。
2. BT-7274 返回 `reviewUrl`，Agent 把链接展示给用户。
3. Agent 调用 `wait_for_review` 等待用户操作。
4. 用户在浏览器里预览文档，选中文本后选择 `要求修改`、`提问` 或 `讨论`，也可以直接点击 `评审通过`。
5. `要求修改` 会创建草稿评论；用户点击 `提交评论` 后，Agent 收到 `comments_submitted` 并修改文档。
6. `提问` 和 `讨论` 会立即创建线程；Agent 收到 `discussion_requested` 后调用 `reply_to_review_thread` 回复。
7. Agent 修改文档时调用 `update_review_document` 发布新版本。
8. 用户在同一个页面继续评审新版本或继续讨论线程。
9. 用户批准后，Agent 收到最终内容并结束流程。

## MCP 工具

### `create_review_session`

创建一个浏览器评审会话。

```json
{
  "title": "Implementation Plan",
  "format": "markdown",
  "content": "# Plan\n\n..."
}
```

返回：

```json
{
  "sessionId": "session_abc123",
  "reviewUrl": "http://127.0.0.1:8787/review/session_abc123",
  "instruction": "Show this URL to the user..."
}
```

`format` 支持 `markdown`、`md` 和 `html`。

大文档也可以把正文写入 UTF-8 文件，然后用绝对路径传入：

```json
{
  "title": "Implementation Plan",
  "format": "markdown",
  "contentPath": "/home/user/review-output/plan.md"
}
```

`content` 和 `contentPath` 必须二选一。

### `wait_for_review`

等待用户提交修改评论、发起/继续讨论线程或批准当前版本。

```json
{
  "sessionId": "session_abc123",
  "timeoutSeconds": 3600
}
```

用户提交评论时返回：

```json
{
  "status": "comments_submitted",
  "sessionId": "session_abc123",
  "versionId": "v1",
  "batchId": "batch_abc123",
  "comments": [
    {
      "id": "comment_abc123",
      "quote": "selected text",
      "comment": "Please clarify this part.",
      "context": {
        "prefix": "text before",
        "suffix": "text after"
      },
      "position": {
        "startOffset": 128,
        "endOffset": 141
      }
    }
  ],
  "generalComment": "Overall feedback"
}
```

用户提问或发起讨论时返回：

```json
{
  "status": "discussion_requested",
  "sessionId": "session_abc123",
  "versionId": "v1",
  "threadId": "thread_abc123",
  "intent": "question",
  "quote": "selected text",
  "message": "这里为什么这么设计？",
  "context": {
    "prefix": "text before",
    "suffix": "text after"
  },
  "position": {
    "startOffset": 128,
    "endOffset": 141
  },
  "instruction": "Reply to this review thread..."
}
```

`message` 只包含最新的用户消息；完整线程历史可通过 `get_review_session` 读取。

用户批准时返回：

```json
{
  "status": "approved",
  "sessionId": "session_abc123",
  "title": "Review document",
  "format": "markdown",
  "versionId": "v2",
  "content": "# Approved content\n\n...",
  "approvedAt": "2026-05-30T08:00:00.000Z",
  "unresolvedCommentCount": 0,
  "instruction": "The user approved this version. Use this approved content as the final version for the current task."
}
```

等待超时时返回：

```json
{
  "status": "timeout",
  "sessionId": "session_abc123",
  "instruction": "Review is still open. Call wait_for_review again with sessionId=\"session_abc123\" unless the user canceled the review."
}
```

### `update_review_document`

把 Agent 修改后的内容发布为新版本。

```json
{
  "sessionId": "session_abc123",
  "content": "# Revised Plan\n\n...",
  "summary": "Addressed review comments"
}
```

也可以用 `contentPath` 从 UTF-8 文件读取新版正文：

```json
{
  "sessionId": "session_abc123",
  "contentPath": "/home/user/review-output/revised-plan.md",
  "summary": "Addressed review comments"
}
```

返回：

```json
{
  "sessionId": "session_abc123",
  "versionId": "v2",
  "reviewUrl": "http://127.0.0.1:8787/review/session_abc123"
}
```

### `reply_to_review_thread`

回复 `discussion_requested` 线程，不创建新文档版本。

```json
{
  "sessionId": "session_abc123",
  "threadId": "thread_abc123",
  "message": "这里选择 A 的原因是..."
}
```

返回：

```json
{
  "sessionId": "session_abc123",
  "threadId": "thread_abc123",
  "messageId": "message_abc123",
  "status": "thread_replied"
}
```

### `get_review_session`

读取当前会话状态，包括版本、评论、讨论线程、批次和批准状态。

```json
{
  "sessionId": "session_abc123"
}
```

## 评论状态

- `draft`：用户在浏览器里创建，还没有提交给 Agent
- `submitted`：已经作为一个批次提交给 Agent
- `addressed`：Agent 发布了新版本，原评论等待用户确认
- `resolved`：用户确认该评论已经解决
- `stale`：新版本里找不到原始引用文本

如果还有未解决评论，用户点击 `评审通过` 时页面会先显示确认提醒。

## 安全与边界

- BT-7274 面向本地开发和本机评审场景，不建议直接暴露到公网。
- 会话数据保存在项目目录 `.bt-7274/sessions`，不是多用户数据库。
- Markdown 默认禁用原始 HTML。
- HTML 预览会移除 `script`、事件属性和 `javascript:` 链接，并放入沙箱 iframe。
- 当前版本重点覆盖文档评审闭环，不提供权限系统、团队空间或远程同步。

## 开发

```bash
npm install
npm run check
node --check public/app.js
```

项目结构：

```text
src/server.js       MCP stdio server and HTTP API
public/index.html   Review page shell
public/app.js       Browser-side review behavior
public/styles.css   Review page styles
docs/README.zh-CN.md Chinese documentation
```

## 名字

BT-7274 的名字来自 Titanfall 中的 BT-7274。这个项目的目标也是让人类和 Agent 在一个任务里更紧密地协作：Agent 负责快速生成和修改，人类负责判断、批注和最终确认。
