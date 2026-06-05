# 图片识别子代理功能设计

## 需求概述

当用户在当前会话中粘贴图片并发送，但当前模型不支持图片时：
1. 创建一个子会话，使用配置的识图模型处理图片
2. 子会话的界面增加"确认识图结果"按钮
3. 用户确认后，将识图结果注入到主会话

## 架构图

```
用户发送消息（文本 + 图片，主模型不支持图片）
  │
  ├─ ① 检测条件：有图片附件 && !fileCaps.image && 已配置识图模型
  │
  ├─ ② sdk.session.create({
  │      parentID: mainSessionId,
  │      title: "图片识别"
  │    })
  │    → 子会话无 directory，不加载项目上下文
  │
  ├─ ③ 前端自动导航到子会话
  │
  ├─ ④ sdk.session.promptAsync(子会话, {
  │      parts: [用户文本, { type: "file", url: dataUrl, mime }],
  │      model: 识图模型,
  │      system: "你是一个图片识别助手...",
  │      tools: {}
  │    })
  │
  ├─ ⑤ 子会话流式返回识图结果，用户可继续对话微调
  │
  ├─ ⑥ 用户点击 [确认识图结果] 按钮
  │
  ├─ ⑦ sdk.session.promptAsync(主会话, {
  │      parts: [{ type: "text", text: "原文\n\n[图片描述：{识图结果}]" }],
  │      model: 主模型
  │    })
  │
  └─ ⑧ 导航回主会话，流式返回主模型回复
```

## UI 路由

用户按下发送键时，InputBox 的 handleSend 进行拦截判定：

```
handleSend()
  ├─ 有图片附件 && 当前模型不支持 && 有识图模型配置？
  │   └─ 是 → interceptSendWithImageRecognition()
  │   └─ 否 → 正常发送
```

## 组件变更

### 1. 设置页 - 识图模型选择器

**文件**: `src/features/settings/components/ModelsSettings.tsx`

在现有 Commit Model 选择器下方新增：

- 标签：`Image Recognition Model`
- 说明：`Select a model for image recognition when the current model doesn't support images`
- 下拉选择器：只列出 `supportsImages: true` 的已启用模型
- 存储 key：`image-recognition-model`

**存储**：使用 `serverStorage`，与 `commitModel` 相同的模式。在 `modelUtils.ts` 中新增：
- `getImageRecognitionModel()`
- `saveImageRecognitionModel()`
- `clearImageRecognitionModel()`

### 2. Send Interception

**文件**: `src/hooks/useChatSession.ts`

在 `sendMessageNow` 中，发送前增加判定逻辑：

```typescript
// 伪代码
async function interceptSendWithImageRecognition(input) {
  const hasImage = input.attachments.some(a => a.mime?.startsWith('image/'))
  const modelSupportsImage = currentModel?.supportsImages
  const imageModel = getImageRecognitionModel()

  if (!hasImage || modelSupportsImage || !imageModel) {
    return sendNormally(input) // 不拦截
  }

  // 1. 创建子会话
  const childSession = await sdk.session.create({
    parentID: input.sessionId,
    title: "图片识别"
  })

  // 2. 导航到子会话
  navigateToSession(childSession.id)

  // 3. 发送图片到子会话（用识图模型）
  await sendMessageAsync({
    sessionId: childSession.id,
    text: input.content,
    attachments: input.attachments, // 带图片
    model: { providerID, modelID }, // 识图模型
    system: "你是一个图片识别助手。请简洁准确地描述图片内容。",
    tools: {},
  })

  // 4. 等待用户点击 [确认识图结果]
  // 存入待确认状态
  setPendingImageConfirm({
    childSessionId: childSession.id,
    mainSessionId: input.sessionId,
  })
}
```

### 3. 确认按钮

**文件**: `src/features/chat/input/InputToolbar.tsx`

新增状态：当当前 session 是识图子会话且有 pending confirm 时，在工具栏显示 `[确认识图结果 →]` 按钮。

按钮逻辑：
- 提取子会话最后一条 assistant 回复的文本
- 发送 `sendMessageAsync` 到主会话
- 导航回主会话
- 清除 pending 状态

### 4. 会话列表分组

**文件**: `src/features/chat/sidebar/SessionChildrenSlot.tsx`（已存在，无需变更）

利用 SDK 已有的 `parentID` 字段 + `childSessionStore`，子会话自动显示在父会话下方。

### 5. 子会话界面

子会话是一个完整的正常会话，用户可以在里面：
- 看到识图模型流式返回结果
- 继续输入文字与识图模型对话
- 随时点击 [确认识图结果] 完成流程

## API 调用细节

### 创建子会话

```typescript
const result = await sdk.session.create({
  body: {
    parentID: mainSessionId,
    title: "图片识别",
  },
})
const childSessionId = result.id
```

### 发送图片到子会话

```typescript
await sdk.session.promptAsync({
  sessionID: childSessionId,
  parts: [
    { type: "text", text: userText },
    { type: "file", mime: "image/png", url: "data:image/png;base64,...", filename: "clipboard.png" },
  ],
  model: { providerID: "openai", modelID: "gpt-4o" },
  system: "你是一个图片识别助手。请根据用户的提问，简洁准确地描述或分析图片内容。",
  tools: {},
})
```

### 发送结果到主会话

```typescript
const description = extractLastAssistantText(childSessionMessages)
await sdk.session.promptAsync({
  sessionID: mainSessionId,
  parts: [
    { type: "text", text: `${originalText}\n\n[图片描述：${description}]` }
  ],
  model: mainModel,
})
```

## 数据流

```
UserInput (text + image attachments)
  → useChatSession.handleSend
    → [intercept] → create child session
      → navigate to child
      → send to child with image model
      → wait for user confirm
        → [confirm] → extract description from child
          → send to main session (text only)
          → navigate back to main
```

## 错误处理

| 场景 | 处理 |
|------|------|
| 创建子会话失败 | 回退到正常发送（模型可能拒绝图片） |
| 导航到子会话失败 | 显示 toast 错误 |
| 识图模型调用失败 | 子会话显示错误消息，用户可重试或取消 |
| 确认时子会话无回复 | 禁用确认按钮，提示等待回复 |

## 打开问题

- 子会话的 `system` 提示词需要根据实际需求微调
- 是否需要支持用户自定义 system prompt（在设置页额外加一个文本框）
