# 图片识别子代理 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 当用户在当前会话粘贴图片并发送、而当前模型不支持图片时，自动创建子会话用识图模型处理，用户确认后将识别结果注入主会话。

**架构：** 通过 `useChatSession.ts` 的 `handleSend` 拦截发送流程 → 创建 `parentID` 指向主会话的子会话 → 导航到子会话并用识图模型 `session.promptAsync` 发送图片 → 子会话界面显示确认按钮 → 确认后提取回复文本注入主会话。

**技术栈：** React 19, TypeScript, @opencode-ai/sdk v2, Tailwind CSS, i18next

---

## 文件清单

### 修改的文件
| 文件 | 职责 |
|------|------|
| `src/utils/modelUtils.ts` | 添加识图模型存储函数 |
| `src/features/settings/components/ModelsSettings.tsx` | 添加识图模型选择器 UI |
| `src/api/message.ts` | `SendMessageParams` 添加 `system`/`tools` 字段，`buildPromptParams` 透传 |
| `src/api/types.ts` | `SendMessageParams` 接口添加 `system`/`tools` |
| `src/hooks/useChatSession.ts` | 拦截发送、创建子会话、确认逻辑 |
| `src/features/chat/InputBox.tsx` | 添加 pendingImageConfirm + 确认/取消按钮 |
| `src/features/chat/ChatPane.tsx` | 传递新 props 到 InputBox |
| `src/locales/en/translation.json` | 新增 i18n key |
| `src/locales/zh-CN/translation.json` | 新增 i18n key |

---

### 任务 1：识图模型存储函数

**文件：**
- 修改：`src/utils/modelUtils.ts`（末尾追加）

- [ ] **步骤 1：在 modelUtils.ts 末尾添加存储函数**

```typescript
// ============================================
// 图片识别模型存储
// ============================================

const IMAGE_RECOGNITION_MODEL_KEY = 'global-image-recognition-model'

export function getImageRecognitionModel(): { modelKey: string; providerId: string; modelId: string } | null {
  try {
    const stored = serverStorage.get(IMAGE_RECOGNITION_MODEL_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function saveImageRecognitionModel(selection: { modelKey: string; providerId: string; modelId: string }): void {
  try {
    serverStorage.set(IMAGE_RECOGNITION_MODEL_KEY, JSON.stringify(selection))
  } catch (e) {
    console.warn('Failed to save image recognition model:', e)
  }
}

export function clearImageRecognitionModel(): void {
  try {
    serverStorage.remove(IMAGE_RECOGNITION_MODEL_KEY)
  } catch (e) {
    console.warn('Failed to clear image recognition model:', e)
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add src/utils/modelUtils.ts
git commit -m "feat: 添加识图模型存储函数"
```

---

### 任务 2：设置页识图模型选择器

**文件：**
- 修改：`src/features/settings/components/ModelsSettings.tsx`
- 修改：`src/locales/en/translation.json`
- 修改：`src/locales/zh-CN/translation.json`

- [ ] **步骤 1：在 ModelsSettings.tsx 中添加识图模型选择器**

在 `</SettingsSection>`（commit model section 的结束）之后、`<SettingsSection title={t('models.visibility')}>` 之前插入：

```tsx
<SettingsSection title={t('models.imageRecognitionTitle')}>
  <p className="text-[length:var(--fs-sm)] text-text-400 leading-relaxed">{t('models.imageRecognitionDesc')}</p>
  <Select
    value={imageRecogModelKey}
    onChange={handleImageRecogModelChange}
    placeholder="—"
    options={imageCapableModels.map(model => ({
      value: getModelKey(model),
      label: model.name,
    }))}
  />
</SettingsSection>
```

在函数顶部添加状态和逻辑：

```typescript
const [imageRecogModelKey, setImageRecogModelKey] = useState<string>(() => getImageRecognitionModel()?.modelKey ?? '')

const imageCapableModels = useMemo(
  () => enabledModels.filter(m => m.supportsImages),
  [enabledModels],
)

const handleImageRecogModelChange = useCallback((value: string) => {
  if (!value) {
    clearImageRecognitionModel()
    setImageRecogModelKey('')
    return
  }
  const parsed = parseModelKey(value)
  if (!parsed) return
  saveImageRecognitionModel({ modelKey: value, providerId: parsed.providerId, modelId: parsed.modelId })
  setImageRecogModelKey(value)
}, [])
```

- [ ] **步骤 2：添加 i18n keys**

**英文** (`src/locales/en/translation.json`):
```json
{
  "models": {
    "imageRecognitionTitle": "Image Recognition Model",
    "imageRecognitionDesc": "When the current model doesn't support images, this model will be used in a sub-session to analyze images."
  }
}
```

**中文** (`src/locales/zh-CN/translation.json`):
```json
{
  "models": {
    "imageRecognitionTitle": "图片识别模型",
    "imageRecognitionDesc": "当当前模型不支持图片时，将使用此模型在子会话中分析图片。"
  }
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/features/settings/components/ModelsSettings.tsx src/locales/en/translation.json src/locales/zh-CN/translation.json
git commit -m "feat: 设置页添加识图模型选择器"
```

---

### 任务 3：扩展 SendMessageParams 支持 system/tools

**文件：**
- 修改：`src/api/types.ts`
- 修改：`src/api/message.ts`

- [ ] **步骤 1：SendMessageParams 添加 system/tools 字段**

在 `src/api/types.ts` 的 `SendMessageParams` 接口中添加：

```typescript
export interface SendMessageParams {
  sessionId: string
  text: string
  attachments: Attachment[]
  model: {
    providerID: string
    modelID: string
  }
  system?: string      // 新增
  tools?: Record<string, boolean>  // 新增
  agent?: string
  variant?: string
  directory?: string
}
```

- [ ] **步骤 2：buildPromptParams 透传 system/tools**

在 `src/api/message.ts` 的 `buildPromptParams` 中，return 语句添加：

```typescript
return {
  sessionID: sessionId,
  directory: formatPathForApi(directory),
  parts,
  model,
  agent,
  variant,
  ...(params.system !== undefined ? { system: params.system } : {}),
  ...(params.tools !== undefined ? { tools: params.tools } : {}),
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/api/types.ts src/api/message.ts
git commit -m "feat: SendMessageParams 支持 system/tools 字段"
```

---

### 任务 4：useChatSession 拦截 + 创建子会话 + 确认逻辑

**文件：**
- 修改：`src/hooks/useChatSession.ts`

- [ ] **步骤 1：在 useChatSession.ts 中定义 pending 状态类型和返回**

在文件顶部 imports 后面（或在 return type 附近）添加：

```typescript
export interface PendingImageConfirm {
  childSessionId: string
  parentSessionId: string
  originalText: string
  parentModel: { providerID: string; modelID: string }
  parentAgent?: string
  parentVariant?: string
}
```

在 return 值的类型中添加（看现有 return 结构，在末尾追加）：

```typescript
pendingImageConfirm: PendingImageConfirm | null
handleConfirmImageResult: () => Promise<void>
handleCancelImageRecognition: () => void
```

- [ ] **步骤 2：在 useChatSession body 中添加状态和确认逻辑**

在 hooks 函数 body 中（约在 `restoreAgentFromMessage` 附近）添加：

```typescript
const [pendingImageConfirm, setPendingImageConfirm] = useState<PendingImageConfirm | null>(null)

const handleConfirmImageResult = useCallback(async () => {
  const pending = pendingImageConfirmRef.current
  if (!pending) return

  // 获取子会话的消息，提取最后一条 assistant 回复
  try {
    const childMessages = await getSessionMessages(pending.childSessionId)
    const lastAssistant = [...childMessages].reverse().find(m => m.info.role === 'assistant')
    const description = lastAssistant?.parts?.filter(p => p.type === 'text').map(p => (p as any).text).join('\n') || ''

    // 发送到主会话
    const text = `${pending.originalText}\n\n[图片描述：${description}]`
    await sendMessageAsync({
      sessionId: pending.parentSessionId,
      text,
      attachments: [],
      model: pending.parentModel,
      agent: pending.parentAgent,
      variant: pending.parentVariant,
      directory: effectiveDirectory || '',
    })

    setPendingImageConfirm(null)
    navigateToSession(pending.parentSessionId)
  } catch (error) {
    handleError('confirm image result', error)
  }
}, [effectiveDirectory, navigateToSession, handleError])

const handleCancelImageRecognition = useCallback(() => {
  setPendingImageConfirm(null)
  if (pendingImageConfirmRef.current) {
    navigateToSession(pendingImageConfirmRef.current.parentSessionId)
  }
}, [navigateToSession])
```

需要添加 `pendingImageConfirmRef`：
```typescript
const pendingImageConfirmRef = useRef<PendingImageConfirm | null>(null)
// 同步 update:
useEffect(() => {
  pendingImageConfirmRef.current = pendingImageConfirm
}, [pendingImageConfirm])
```

- [ ] **步骤 3：在 sendMessageNow 中添加拦截逻辑**

在 `sendMessageNow` 函数开头，现有 `if (!sessionId)` 检查之前插入：

```typescript
// 检测是否需要图片识别子代理
const hasImageAttachments = input.attachments.some(a => a.mime?.startsWith('image/'))
const imageModelConfig = hasImageAttachments && !input.imageSupported ? getImageRecognitionModel() : null

if (hasImageAttachments && !input.model.imageSupported && imageModelConfig) {
  try {
    // 创建子会话
    const sdk = getSDKClient()
    const childResult = await sdk.session.create({
      body: {
        parentID: input.sessionId ?? sessionId ?? undefined,
        title: '图片识别',
      },
    })
    const childSessionId = childResult.id

    // 发送图片到子会话
    const childText = input.content
    const childParts: any[] = [{ type: 'text', text: childText }]
    for (const att of input.attachments) {
      if (att.url) {
        childParts.push({
          type: 'file',
          mime: att.mime || 'image/png',
          url: att.url,
          filename: att.displayName,
        })
      }
    }

    await sendMessageAsync({
      sessionId: childSessionId,
      text: childText,
      attachments: input.attachments,
      model: {
        providerID: imageModelConfig.providerId,
        modelID: imageModelConfig.modelId,
      },
      system: '你是一个图片识别助手。请根据用户的提问简洁准确地描述图片内容。',
      tools: {},
      directory: input.directory,
    })

    // 设置 pending confirm
    const pending: PendingImageConfirm = {
      childSessionId,
      parentSessionId: input.sessionId ?? sessionId ?? '',
      originalText: input.content,
      parentModel: input.model,
      parentAgent: input.options?.agent,
      parentVariant: input.options?.variant,
    }
    setPendingImageConfirm(pending)
    
    // 导航到子会话
    navigateToSession(childSessionId, input.directory)
    
    return true
  } catch (error) {
    handleError('image recognition', error)
    return false
  }
}
```

注意：`sendMessageNow` 的 `input` 类型需要添加 `imageSupported?: boolean` 字段，或在调用时传入 `currentModel.supportsImages`。

修改 `sendMessageNow` 的调用处，传入 `imageSupported`：
```typescript
return sendMessageNow({
  ...,
  imageSupported: currentModel?.supportsImages ?? false,
})
```

而原本的 `sendMessageNow` 调用（在 `handleSend` 中）已经传了 `model`，可以直接从 `currentModel` 判断。

调整：在 `sendMessageNow` 的类型 interface 中添加 `imageSupported` 字段。或者在 function 调用处把 `currentModel` 传进去。更简单的方式：直接在 `sendMessageNow` 内部读取 `getImageRecognitionModel()`（但要考虑依赖问题）。

方案：把 `imageSupported` 作为 `input` 的一部分传入。

```typescript
// sendMessageNow 的 input 类型添加
imageSupported?: boolean
```

- [ ] **步骤 4：在 handleSend 中传入 `imageSupported`**

```typescript
return sendMessageNow({
  sessionId: routeSessionId,
  content,
  attachments,
  model: {
    providerID: currentModel.providerId,
    modelID: currentModel.id,
  },
  imageSupported: currentModel.supportsImages,
  options,
  directory: effectiveDirectory || '',
  allowCreateSession: true,
})
```

- [ ] **步骤 5：Commit**

```bash
git add src/hooks/useChatSession.ts
git commit -m "feat: 添加图片识别子代理拦截逻辑"
```

---

### 任务 5：InputBox 确认按钮与取消按钮

**文件：**
- 修改：`src/features/chat/InputBox.tsx`

- [ ] **步骤 1：在 InputBoxProps 中添加新 props**

```typescript
pendingImageConfirm?: {
  childSessionId: string
  parentSessionId: string
} | null
onConfirmImageResult?: () => void
onCancelImageRecognition?: () => void
```

- [ ] **步骤 2：在 InputToolbar 之前或之后添加确认按钮**

在 render 中，attachment rail 和 textarea 之间，或 InputToolbar 位置，添加：

```tsx
{pendingImageConfirm && sessionId === pendingImageConfirm.childSessionId && (
  <div className="flex items-center gap-2 px-4 py-2 border-t border-border-200/50">
    <div className="flex-1 min-w-0">
      <div className="text-[length:var(--fs-sm)] text-text-300 truncate">
        {t('inputBox.imageRecognitionSubtitle')}
      </div>
    </div>
    <button
      type="button"
      onClick={onConfirmImageResult}
      disabled={isSubmitting}
      className="px-3 py-1.5 text-[length:var(--fs-sm)] font-medium rounded-lg bg-accent-main-100 text-white hover:bg-accent-main-100/90 transition-colors disabled:opacity-50"
    >
      {t('inputBox.confirmImageResult')}
    </button>
    <button
      type="button"
      onClick={onCancelImageRecognition}
      disabled={isSubmitting}
      className="px-3 py-1.5 text-[length:var(--fs-sm)] text-text-400 hover:text-text-200 transition-colors"
    >
      {t('common:cancel')}
    </button>
  </div>
)}
```

- [ ] **步骤 3：添加 i18n keys**

**英文：**
```json
{
  "inputBox": {
    "imageRecognitionSubtitle": "Image recognition result — review and confirm to send to main session",
    "confirmImageResult": "Confirm →"
  }
}
```

**中文：**
```json
{
  "inputBox": {
    "imageRecognitionSubtitle": "图片识别结果 — 确认后发送到主会话",
    "confirmImageResult": "确认识图结果 →"
  }
}
```

- [ ] **步骤 4：Commit**

```bash
git add src/features/chat/InputBox.tsx src/locales/en/translation.json src/locales/zh-CN/translation.json
git commit -m "feat: InputBox 添加识图确认/取消按钮"
```

---

### 任务 6：ChatPane 传递 props 到 InputBox

**文件：**
- 修改：`src/features/chat/ChatPane.tsx`

- [ ] **步骤 1：从 useChatSession 获取新返回值并传给 InputBox**

```tsx
const {
  ...,
  pendingImageConfirm,
  handleConfirmImageResult,
  handleCancelImageRecognition,
} = useChatSession({...})
```

在 InputBox 中传递：

```tsx
<InputBox
  ...
  pendingImageConfirm={pendingImageConfirm}
  onConfirmImageResult={handleConfirmImageResult}
  onCancelImageRecognition={handleCancelImageRecognition}
/>
```

- [ ] **步骤 2：Commit**

```bash
git add src/features/chat/ChatPane.tsx
git commit -m "feat: ChatPane 传递识图确认 props 到 InputBox"
```

---

### 任务 7：子会话导航时禁用发送栏（防止误操作）

**文件：**
- 修改：`src/features/chat/InputBox.tsx`

- [ ] **步骤 1：在 pendingImageConfirm 时禁用 textarea 和发送**

当 `pendingImageConfirm && sessionId === pendingImageConfirm.childSessionId` 时，让 textarea disabled 并提示等待确认：

```tsx
disabled={inputDisabled || (pendingImageConfirm && sessionId === pendingImageConfirm.childSessionId)}
```

或者更优雅：不 disable textarea（用户可以继续在子会话对话微调），只是禁用工具栏中的发送按钮，确认按钮替代它。

- [ ] **步骤 2：Commit**

```bash
git add src/features/chat/InputBox.tsx
git commit -m "feat: 识图子会话中调整输入栏状态"
```

---

### 任务 8：自检与端到端验证

- [ ] **步骤 1：类型检查**

```bash
npm run typecheck
```

修复所有类型错误。

- [ ] **步骤 2：运行现有测试**

```bash
npm run test:run
```

确认没有回归。

- [ ] **步骤 3：Lint**

```bash
npm run lint
```

修复所有 lint 错误。

- [ ] **步骤 4：最终 commit**

```bash
git add -A
git commit -m "feat: 实现图片识别子代理全功能"
```
