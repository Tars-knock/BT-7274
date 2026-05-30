# Review MCP

Review MCP 是一个本地 MCP server，用于在 agent 工作流中审阅大模型生成的
Markdown / HTML 文档。

它会创建一个浏览器评审页面。开发者可以在页面中预览文档、通过左侧目录树跳转
章节、圈选文字、添加多条评论、一次性提交评论，或者直接评审通过当前版本。agent
可以等待评审结果，根据评论修改文档，并把新版发布回同一个评审 session。

[English README](../README.md)

## 功能

- 支持 Markdown 和 HTML 文档评审
- 浏览器预览，左侧自动生成标题目录树
- 支持圈选文字并添加评论
- 通过统一的 `提交评论` 按钮批量提交评论
- 通过 `评审通过` 明确接受当前版本
- 有未解决评论时点击通过会弹出确认提示
- 支持版本历史和与上一版的 diff
- agent 可通过 MCP tool 等待评审结果
- MVP 使用本地内存存储
- HTML 使用 sandboxed iframe 预览，并默认移除脚本

## 环境要求

- Node.js 20 或更高版本
- 支持 stdio MCP server 的 MCP client

当前 MVP 不需要安装 npm 依赖。

## 本地运行

```bash
npm start
```

评审页面默认监听：

```text
http://127.0.0.1:8787
```

可以通过环境变量覆盖 host、port 和对外展示的 base URL：

```bash
REVIEW_MCP_HOST=127.0.0.1 \
REVIEW_MCP_PORT=8787 \
REVIEW_MCP_BASE_URL=http://127.0.0.1:8787 \
npm start
```

## MCP Client 配置

把 MCP client 配置为启动：

```bash
node /home/tars/projects/BT-7274/src/server.js
```

示例配置：

```json
{
  "mcpServers": {
    "review-mcp": {
      "command": "node",
      "args": ["/home/tars/projects/BT-7274/src/server.js"]
    }
  }
}
```

## 评审流程

1. agent 调用 `create_review_session`，提交 Markdown 或 HTML 文档。
2. Review MCP 返回 `reviewUrl` 和提示文案。
3. agent 把 URL 展示给用户，并调用 `wait_for_review` 等待。
4. 用户在浏览器中打开评审页面。
5. 用户可以：
   - 圈选文字、创建评论，然后点击 `提交评论`；或
   - 点击 `评审通过`，接受当前版本。
6. `wait_for_review` 返回 `comments_submitted` 或 `approved`。
7. 如果用户提交了评论，agent 修改文档后调用 `update_review_document`。
8. 浏览器页面自动更新到最新版，并可查看 diff 和历史版本。

## MCP Tools

### `create_review_session`

创建浏览器评审 session。

输入：

```json
{
  "title": "Implementation Plan",
  "format": "markdown",
  "content": "# Plan\n\n..."
}
```

输出：

```json
{
  "sessionId": "session_abc123",
  "reviewUrl": "http://127.0.0.1:8787/review/session_abc123",
  "instruction": "请打开评审页面完成审阅：http://127.0.0.1:8787/review/session_abc123。完成后点击“提交评论”或“评审通过”。"
}
```

### `wait_for_review`

等待用户提交评论或评审通过。

输入：

```json
{
  "sessionId": "session_abc123",
  "timeoutSeconds": 3600
}
```

提交评论时的输出：

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
      }
    }
  ],
  "generalComment": "Overall feedback"
}
```

评审通过时的输出：

```json
{
  "status": "approved",
  "sessionId": "session_abc123",
  "versionId": "v2",
  "approvedAt": "2026-05-30T08:00:00.000Z",
  "unresolvedCommentCount": 0
}
```

超时时的输出：

```json
{
  "status": "timeout",
  "sessionId": "session_abc123"
}
```

### `update_review_document`

向已有评审 session 发布修改后的新版本。

输入：

```json
{
  "sessionId": "session_abc123",
  "content": "# Revised Plan\n\n...",
  "summary": "Addressed review comments"
}
```

输出：

```json
{
  "sessionId": "session_abc123",
  "versionId": "v2",
  "reviewUrl": "http://127.0.0.1:8787/review/session_abc123"
}
```

### `get_review_session`

返回当前 session 状态，包括版本、评论、批次和通过状态。

输入：

```json
{
  "sessionId": "session_abc123"
}
```

## 评论状态

- `draft`：已在浏览器创建，但尚未提交给 agent
- `submitted`：已批量提交给 agent
- `addressed`：评论提交后，agent 已发布新版本
- `resolved`：评审者确认该评论已解决
- `stale`：新版中无法找到原评论引用的文字

未解决状态包括 `draft`、`submitted`、`addressed` 和 `stale`。如果存在未解决评论时
点击 `评审通过`，页面会先弹出确认提示。

## 安全说明

- 当前版本面向本地开发环境。
- session 数据保存在内存中，进程退出后会丢失。
- Markdown 使用内置轻量渲染器渲染。
- HTML 会被清理后放入 sandboxed iframe 展示。
- 生成的 HTML 脚本默认会被移除。

## 开发

语法检查：

```bash
npm run check
node --check public/app.js
```

项目结构：

```text
src/server.js       MCP stdio server 和 HTTP API
public/index.html   评审页面结构
public/app.js       浏览器端评审交互
public/styles.css   评审页面样式
docs/README.zh-CN.md 中文文档
```
