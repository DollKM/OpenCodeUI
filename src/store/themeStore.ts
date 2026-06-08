/**
 * 涓婚鐘舵€佺鐞?Store
 *
 * 绠＄悊锛?
 * - 涓婚椋庢牸閫夋嫨锛堝唴缃璁撅級
 * - 鏃ュ妯″紡锛坰ystem / light / dark锛?
 * - 鑷畾涔?CSS 瑕嗙洊锛堝彲鐢ㄤ簬瑕嗙洊瀛椾綋绛夛級
 * - CSS 鍙橀噺娉ㄥ叆
 */

import { getThemePreset, themeColorsToCSSVars, builtinThemes, DEFAULT_THEME_ID } from '../themes'
import type { ThemePreset, ThemeColors } from '../themes'
import { clientDataStorage } from '../lib/clientDataStorage'

// ============================================
// Color Conversion Utility
// ============================================

/**
 * 灏嗘祻瑙堝櫒 getComputedStyle 杩斿洖鐨勪换鎰忔牸寮忛鑹插瓧绗︿覆杞负 #RRGGBB 鍗佸叚杩涘埗
 *
 * 鐜颁唬 Chromium WebView 鍙兘杩斿洖澶氱鏍煎紡锛?
 * - rgb(29, 36, 50)   鈥?閫楀彿鍒嗛殧
 * - rgb(29 36 50)     鈥?绌烘牸鍒嗛殧 (CSS Color Level 4)
 * - color(srgb 0.11 0.14 0.20) 鈥?sRGB 鍑芥暟
 * - oklch(...)        鈥?OKLab 鑹插僵绌洪棿
 *
 * 鍒╃敤 Canvas 2D 鍋氫竾鑳借浆鎹紝璁╂祻瑙堝櫒鑷繁瑙ｆ瀽浠讳綍鍚堟硶 CSS 棰滆壊
 */
function computedColorToHex(cssColor: string): string | null {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = cssColor
    // ctx.fillStyle 浼氳娴忚鍣ㄦ爣鍑嗗寲涓?#rrggbb 鎴?rgba(...) 鏍煎紡
    const normalized = ctx.fillStyle
    if (normalized.startsWith('#')) return normalized
    // 濡傛灉杩斿洖 rgba/rgb 鏍煎紡锛屾彁鍙栨暟鍊艰浆 hex
    const match = normalized.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (match) {
      const r = parseInt(match[1], 10)
      const g = parseInt(match[2], 10)
      const b = parseInt(match[3], 10)
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
    }
    return null
  } catch {
    return null
  }
}

// ============================================
// Types
// ============================================

export type ColorMode = 'system' | 'light' | 'dark'

export interface CustomCSSSnippet {
  id: string
  name: string
  css: string
  createdAt: number
  updatedAt: number
}

/** step-finish 淇℃伅鏍忓悇椤规樉绀哄紑鍏?*/
export interface StepFinishDisplay {
  tokens: boolean
  cache: boolean
  cost: boolean
  duration: boolean
  turnDuration: boolean
  agent: boolean
  model: boolean
  completedAt: boolean
}

export type CompletedAtFormat = 'time' | 'dateTime'

export type ReasoningDisplayMode = 'capsule' | 'italic' | 'markdown'

export type ExternalFileDropMode = 'upload-first' | 'mention'

/**
 * 瀛楀彿鍋忕Щ鑼冨洿锛?2 ~ +4锛堢浉瀵逛簬鍩哄噯鍊肩殑 px 鍋忕Щ锛?
 * 0 = 鍩哄噯鍊硷紙index.css 涓畾涔夌殑榛樿鍊硷級
 */
export const FONT_SCALE_MIN = -2
export const FONT_SCALE_MAX = 4

function clampFontScale(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, n)))
}

/** Diff 琛屾爣璁伴鏍硷細markers = 浼犵粺 +/- 绗﹀彿, changeBars = 琛屽彿宸︿晶褰╄壊绔栨潯 */
export type DiffStyle = 'markers' | 'changeBars'

const DEFAULT_STEP_FINISH_DISPLAY: StepFinishDisplay = {
  tokens: true,
  cache: true,
  cost: true,
  duration: true,
  turnDuration: true,
  agent: false,
  model: false,
  completedAt: false,
}

const DEFAULT_COMPLETED_AT_FORMAT: CompletedAtFormat = 'time'

const DEFAULT_REASONING_DISPLAY_MODE: ReasoningDisplayMode = 'capsule'
const DEFAULT_DIFF_STYLE: DiffStyle = 'markers'
const DEFAULT_DESCRIPTIVE_TOOL_STEPS = false
const DEFAULT_INLINE_TOOL_REQUESTS = false
const DEFAULT_CODE_WORD_WRAP = false
const DEFAULT_UI_FONT_SCALE = 0
const DEFAULT_CODE_FONT_SCALE = 0

/** 宸ュ叿杈撳嚭娓叉煋椋庢牸锛歝lassic = 缁忓吀锛坕nput+output 鍒嗙锛夛紝compact = 绮剧畝锛堝彧灞曠ず output锛宧eader 鏇寸煯锛?*/
export type ToolCardStyle = 'classic' | 'compact'
const DEFAULT_TOOL_CARD_STYLE: ToolCardStyle = 'classic'
const DEFAULT_IMMERSIVE_MODE = false
const DEFAULT_COMPACT_INLINE_PERMISSION = false
const DEFAULT_GLASS_EFFECT = true
const DEFAULT_QUEUE_FOLLOWUP_MESSAGES = false
const DEFAULT_MANUAL_TERMINAL_TITLES = false
const DEFAULT_EXTERNAL_FILE_DROP_MODE: ExternalFileDropMode = 'upload-first'

export interface ThemeState {
  /** 褰撳墠閫変腑鐨勪富棰橀鏍?ID */
  presetId: string
  /** 鏃ュ妯″紡 */
  colorMode: ColorMode
  /** 鐢ㄦ埛鑷畾涔?CSS锛堣鐩?CSS 鍙橀噺锛?*/
  customCSS: string
  /** 宸蹭繚瀛樼殑鑷畾涔?CSS 鏂规 */
  customCSSSnippets: CustomCSSSnippet[]
  /** 褰撳墠閫変腑鐨勫凡淇濆瓨鏂规 ID锛涗粎鐢ㄤ簬鍒囨崲/淇濆瓨锛屼笉鐩存帴鍐冲畾娓叉煋 */
  activeCustomCSSSnippetId: string | null
  /** 鏄惁鑷姩鎶樺彔闀跨敤鎴锋秷鎭?*/
  collapseUserMessages: boolean
  /** step-finish 淇℃伅鏍忔樉绀哄紑鍏?*/
  stepFinishDisplay: StepFinishDisplay
  /** 瀹屾垚鏃跺埢鏄剧ず鏍煎紡 */
  completedAtFormat: CompletedAtFormat
  /** 鎬濊€冨唴瀹瑰睍绀烘牱寮?*/
  reasoningDisplayMode: ReasoningDisplayMode
  /** 瀹芥ā寮?*/
  wideMode: boolean
  /** Diff 琛屾爣璁伴鏍?*/
  diffStyle: DiffStyle
  /** 鏄惁鍚敤甯﹀伐鍏锋弿杩扮殑 steps 鎽樿 */
  descriptiveToolSteps: boolean
  /** 鏄惁鍦ㄥ伐鍏蜂笅鏂瑰唴宓屾潈闄?鎻愰棶璇锋眰 */
  inlineToolRequests: boolean
  /** 浠ｇ爜鍧?diff 鑷姩鎹㈣ */
  codeWordWrap: boolean
  /** UI 瀛楀彿鍋忕Щ (px)锛? = 鍩哄噯 */
  uiFontScale: number
  /** 浠ｇ爜 / diff / 缁堢瀛楀彿鍋忕Щ (px)锛? = 鍩哄噯 */
  codeFontScale: number
  /** 宸ュ叿杈撳嚭娓叉煋椋庢牸 */
  toolCardStyle: ToolCardStyle
  /** 娌夋蹈妯″紡 */
  immersiveMode: boolean
  /** 鍐呭祵鏉冮檺绮剧畝妯″紡锛歍oolBody 鏈夊唴瀹规椂鍙樉绀烘搷浣滄寜閽?*/
  compactInlinePermission: boolean
  /** 姣涚幓鐠冩晥鏋滃紑鍏筹紙backdrop-filter blur锛?*/
  glassEffect: boolean
  /** 蹇欑鏃跺悗缁秷鎭槸鍚﹁繘鍏ラ槦鍒?*/
  queueFollowupMessages: boolean
  /** 缁堢鏍囩鏄惁鏀逛负鎵嬪姩鍛藉悕妯″紡 */
  manualTerminalTitles: boolean
  /** 外部文件拖入输入框时的处理方式 */
  externalFileDropMode: ExternalFileDropMode
}

export type ThemeBackup = ThemeState

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY_PRESET = 'theme-preset'
const STORAGE_KEY_COLOR_MODE = 'theme-mode'
const STORAGE_KEY_CUSTOM_CSS = 'theme-custom-css'
const STORAGE_KEY_CUSTOM_CSS_SNIPPETS = 'theme-custom-css-snippets'
const STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID = 'theme-active-custom-css-snippet-id'
const STORAGE_KEY_COLLAPSE_USER_MESSAGES = 'collapse-user-messages'
const STORAGE_KEY_STEP_FINISH_DISPLAY = 'step-finish-display'
const STORAGE_KEY_COMPLETED_AT_FORMAT = 'completed-at-format'
const STORAGE_KEY_REASONING_DISPLAY_MODE = 'reasoning-display-mode'
const STORAGE_KEY_WIDE_MODE = 'chat-wide-mode'
const STORAGE_KEY_DIFF_STYLE = 'diff-style'
const STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS = 'descriptive-tool-steps'
const STORAGE_KEY_INLINE_TOOL_REQUESTS = 'inline-tool-requests'
const STORAGE_KEY_CODE_WORD_WRAP = 'code-word-wrap'
const STORAGE_KEY_FONT_SCALE = 'font-scale'
const STORAGE_KEY_CODE_FONT_SCALE = 'code-font-scale'
const STORAGE_KEY_TOOL_CARD_STYLE = 'tool-card-style'
const STORAGE_KEY_IMMERSIVE_MODE = 'immersive-mode'
const STORAGE_KEY_COMPACT_INLINE_PERMISSION = 'compact-inline-permission'
const STORAGE_KEY_GLASS_EFFECT = 'glass-effect'
const STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES = 'queue-followup-messages'
const STORAGE_KEY_MANUAL_TERMINAL_TITLES = 'manual-terminal-titles'
const STORAGE_KEY_EXTERNAL_FILE_DROP_MODE = 'external-file-drop-mode'

// ============================================
// DOM Style Element IDs
// ============================================

const STYLE_ID_THEME = 'opencode-theme-vars'
const STYLE_ID_FONT_SCALE = 'opencode-font-scale'
const STYLE_ID_CUSTOM = 'opencode-custom-css'

function parseCustomCSSSnippets(raw: string | null): CustomCSSSnippet[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (item): item is CustomCSSSnippet =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.css === 'string' &&
        typeof item.createdAt === 'number' &&
        typeof item.updatedAt === 'number',
    )
  } catch {
    return []
  }
}

// ============================================
// Store Implementation
// ============================================

class ThemeStore {
  private state: ThemeState
  private listeners = new Set<() => void>()

  constructor() {
    const savedPreset = clientDataStorage.getItem(STORAGE_KEY_PRESET) || DEFAULT_THEME_ID
    const normalizedPreset = getThemePreset(savedPreset) ? savedPreset : DEFAULT_THEME_ID
    const savedMode = (clientDataStorage.getItem(STORAGE_KEY_COLOR_MODE) as ColorMode) || 'system'
    const savedCSS = clientDataStorage.getItem(STORAGE_KEY_CUSTOM_CSS) || ''
    const customCSSSnippets = parseCustomCSSSnippets(clientDataStorage.getItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS))
    const savedActiveCustomCSSSnippetId = clientDataStorage.getItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    const activeCustomCSSSnippetId = customCSSSnippets.some(item => item.id === savedActiveCustomCSSSnippetId)
      ? savedActiveCustomCSSSnippetId
      : null
    const savedCollapse = clientDataStorage.getItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES)
    const collapseUserMessages = savedCollapse === null ? true : savedCollapse === 'true'
    const savedReasoningDisplay = clientDataStorage.getItem(STORAGE_KEY_REASONING_DISPLAY_MODE)
    const reasoningDisplayMode: ReasoningDisplayMode =
      savedReasoningDisplay === 'italic' || savedReasoningDisplay === 'markdown'
        ? savedReasoningDisplay
        : DEFAULT_REASONING_DISPLAY_MODE

    let stepFinishDisplay = DEFAULT_STEP_FINISH_DISPLAY
    try {
      const saved = clientDataStorage.getItem(STORAGE_KEY_STEP_FINISH_DISPLAY)
      if (saved) stepFinishDisplay = { ...DEFAULT_STEP_FINISH_DISPLAY, ...JSON.parse(saved) }
    } catch {
      /* ignore */
    }

    const savedCompletedAtFormat = clientDataStorage.getItem(STORAGE_KEY_COMPLETED_AT_FORMAT)
    const completedAtFormat: CompletedAtFormat =
      savedCompletedAtFormat === 'dateTime' ? 'dateTime' : DEFAULT_COMPLETED_AT_FORMAT

    const savedWideMode = clientDataStorage.getItem(STORAGE_KEY_WIDE_MODE) === 'true'
    const savedDiffStyle = clientDataStorage.getItem(STORAGE_KEY_DIFF_STYLE) as DiffStyle | null
    const diffStyle: DiffStyle = savedDiffStyle === 'changeBars' ? 'changeBars' : DEFAULT_DIFF_STYLE

    const savedDescriptiveToolSteps = clientDataStorage.getItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS)
    const descriptiveToolSteps =
      savedDescriptiveToolSteps === null ? DEFAULT_DESCRIPTIVE_TOOL_STEPS : savedDescriptiveToolSteps === 'true'

    const savedInlineToolRequests = clientDataStorage.getItem(STORAGE_KEY_INLINE_TOOL_REQUESTS)
    const inlineToolRequests =
      savedInlineToolRequests === null ? DEFAULT_INLINE_TOOL_REQUESTS : savedInlineToolRequests === 'true'

    const savedCodeWordWrap = clientDataStorage.getItem(STORAGE_KEY_CODE_WORD_WRAP)
    const codeWordWrap = savedCodeWordWrap === 'true' ? true : DEFAULT_CODE_WORD_WRAP

    const savedFontScale = clientDataStorage.getItem(STORAGE_KEY_FONT_SCALE)
    const uiFontScale = savedFontScale !== null ? clampFontScale(Number(savedFontScale)) : DEFAULT_UI_FONT_SCALE

    const savedCodeFontScale = clientDataStorage.getItem(STORAGE_KEY_CODE_FONT_SCALE)
    const codeFontScale =
      savedCodeFontScale !== null ? clampFontScale(Number(savedCodeFontScale)) : DEFAULT_CODE_FONT_SCALE

    const savedToolCardStyle = clientDataStorage.getItem(STORAGE_KEY_TOOL_CARD_STYLE) as ToolCardStyle | null
    const toolCardStyle: ToolCardStyle =
      savedToolCardStyle === 'classic' || savedToolCardStyle === 'compact'
        ? savedToolCardStyle
        : DEFAULT_TOOL_CARD_STYLE

    const savedImmersiveMode = clientDataStorage.getItem(STORAGE_KEY_IMMERSIVE_MODE)
    const immersiveMode = savedImmersiveMode === 'true' ? true : DEFAULT_IMMERSIVE_MODE

    const savedCompactInlinePermission = clientDataStorage.getItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION)
    const compactInlinePermission =
      savedCompactInlinePermission === null
        ? DEFAULT_COMPACT_INLINE_PERMISSION
        : savedCompactInlinePermission === 'true'

    const savedGlassEffect = clientDataStorage.getItem(STORAGE_KEY_GLASS_EFFECT)
    const glassEffect = savedGlassEffect === null ? DEFAULT_GLASS_EFFECT : savedGlassEffect === 'true'

    const savedQueueFollowupMessages = clientDataStorage.getItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES)
    const queueFollowupMessages =
      savedQueueFollowupMessages === null ? DEFAULT_QUEUE_FOLLOWUP_MESSAGES : savedQueueFollowupMessages === 'true'

    const savedManualTerminalTitles = clientDataStorage.getItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES)
    const manualTerminalTitles =
      savedManualTerminalTitles === null ? DEFAULT_MANUAL_TERMINAL_TITLES : savedManualTerminalTitles === 'true'

    const savedExternalFileDropMode = localStorage.getItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE)
    const externalFileDropMode: ExternalFileDropMode =
      savedExternalFileDropMode === 'mention' ? 'mention' : DEFAULT_EXTERNAL_FILE_DROP_MODE

    this.state = {
      presetId: normalizedPreset,
      colorMode: savedMode,
      customCSS: savedCSS,
      customCSSSnippets,
      activeCustomCSSSnippetId,
      collapseUserMessages,
      stepFinishDisplay,
      completedAtFormat,
      reasoningDisplayMode,
      wideMode: savedWideMode,
      diffStyle,
      descriptiveToolSteps,
      inlineToolRequests,
      codeWordWrap,
      uiFontScale,
      codeFontScale,
      toolCardStyle,
      immersiveMode,
      compactInlinePermission,
      glassEffect,
      queueFollowupMessages,
      manualTerminalTitles,
      externalFileDropMode,
    }
  }

  // ---- Getters ----

  getState(): ThemeState {
    return this.state
  }

  get presetId() {
    return this.state.presetId
  }
  get colorMode() {
    return this.state.colorMode
  }
  get customCSS() {
    return this.state.customCSS
  }
  get customCSSSnippets() {
    return this.state.customCSSSnippets
  }
  get activeCustomCSSSnippetId() {
    return this.state.activeCustomCSSSnippetId
  }
  get collapseUserMessages() {
    return this.state.collapseUserMessages
  }
  get stepFinishDisplay() {
    return this.state.stepFinishDisplay
  }
  get completedAtFormat() {
    return this.state.completedAtFormat
  }
  get reasoningDisplayMode() {
    return this.state.reasoningDisplayMode
  }
  get wideMode() {
    return this.state.wideMode
  }
  get diffStyle() {
    return this.state.diffStyle
  }
  get descriptiveToolSteps() {
    return this.state.descriptiveToolSteps
  }
  get inlineToolRequests() {
    return this.state.inlineToolRequests
  }
  get codeWordWrap() {
    return this.state.codeWordWrap
  }
  get uiFontScale() {
    return this.state.uiFontScale
  }
  get codeFontScale() {
    return this.state.codeFontScale
  }
  get toolCardStyle() {
    return this.state.toolCardStyle
  }
  get immersiveMode() {
    return this.state.immersiveMode
  }
  get compactInlinePermission() {
    return this.state.compactInlinePermission
  }
  get glassEffect() {
    return this.state.glassEffect
  }
  get queueFollowupMessages() {
    return this.state.queueFollowupMessages
  }
  get manualTerminalTitles() {
    return this.state.manualTerminalTitles
  }
  get externalFileDropMode() {
    return this.state.externalFileDropMode
  }

  /** 鑾峰彇褰撳墠涓婚棰勮锛堝唴缃富棰樿繑鍥炲璞★紝鑷畾涔夎繑鍥?undefined锛?*/
  getPreset(): ThemePreset | undefined {
    return getThemePreset(this.state.presetId)
  }

  /** 鑾峰彇鎵€鏈夊彲鐢ㄤ富棰樺垪琛?*/
  getAvailablePresets(): { id: string; name: string; description: string }[] {
    return builtinThemes.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
    }))
  }

  /** 瑙ｆ瀽瀹為檯鐢熸晥鐨勬殫/浜ā寮?*/
  getResolvedMode(): 'light' | 'dark' {
    if (this.state.colorMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return this.state.colorMode
  }

  get isDark(): boolean {
    return this.getResolvedMode() === 'dark'
  }

  // ---- Mutations ----

  setPreset(id: string) {
    if (this.state.presetId === id) return
    this.state = { ...this.state, presetId: id }
    clientDataStorage.setItem(STORAGE_KEY_PRESET, id)
    this.applyTheme()
    this.emit()
  }

  setColorMode(mode: ColorMode) {
    if (this.state.colorMode === mode) return
    this.state = { ...this.state, colorMode: mode }
    clientDataStorage.setItem(STORAGE_KEY_COLOR_MODE, mode)
    this.applyTheme()
    this.emit()
  }

  setCustomCSS(css: string) {
    this.state = { ...this.state, customCSS: css }
    clientDataStorage.setItem(STORAGE_KEY_CUSTOM_CSS, css)
    this.applyCustomCSS()
    this.emit()
  }

  saveCustomCSSSnippet(name: string, css: string): CustomCSSSnippet {
    const now = Date.now()
    const snippet: CustomCSSSnippet = {
      id: `css-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      css,
      createdAt: now,
      updatedAt: now,
    }

    const customCSSSnippets = [...this.state.customCSSSnippets, snippet]
    this.state = { ...this.state, customCSSSnippets, activeCustomCSSSnippetId: snippet.id }
    this.persistCustomCSSSnippets(customCSSSnippets)
    clientDataStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, snippet.id)
    this.emit()
    return snippet
  }

  updateCustomCSSSnippet(id: string, updates: Partial<Pick<CustomCSSSnippet, 'name' | 'css'>>) {
    const customCSSSnippets = this.state.customCSSSnippets.map(item =>
      item.id === id ? { ...item, ...updates, updatedAt: Date.now() } : item,
    )

    this.state = { ...this.state, customCSSSnippets }
    this.persistCustomCSSSnippets(customCSSSnippets)
    this.emit()
  }

  deleteCustomCSSSnippet(id: string) {
    const customCSSSnippets = this.state.customCSSSnippets.filter(item => item.id !== id)
    const activeCustomCSSSnippetId =
      this.state.activeCustomCSSSnippetId === id ? null : this.state.activeCustomCSSSnippetId

    this.state = { ...this.state, customCSSSnippets, activeCustomCSSSnippetId }
    this.persistCustomCSSSnippets(customCSSSnippets)

    if (activeCustomCSSSnippetId) {
      clientDataStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, activeCustomCSSSnippetId)
    } else {
      clientDataStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    }

    this.emit()
  }

  applyCustomCSSSnippet(id: string) {
    const snippet = this.state.customCSSSnippets.find(item => item.id === id)
    if (!snippet) return

    this.state = {
      ...this.state,
      customCSS: snippet.css,
      activeCustomCSSSnippetId: id,
    }

    clientDataStorage.setItem(STORAGE_KEY_CUSTOM_CSS, snippet.css)
    clientDataStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, id)
    this.applyCustomCSS()
    this.emit()
  }

  clearActiveCustomCSSSnippet() {
    if (this.state.activeCustomCSSSnippetId === null) return
    this.state = { ...this.state, activeCustomCSSSnippetId: null }
    clientDataStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    this.emit()
  }

  setCollapseUserMessages(enabled: boolean) {
    if (this.state.collapseUserMessages === enabled) return
    this.state = { ...this.state, collapseUserMessages: enabled }
    clientDataStorage.setItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(enabled))
    this.emit()
  }

  setStepFinishDisplay(display: Partial<StepFinishDisplay>) {
    const next = { ...this.state.stepFinishDisplay, ...display }
    this.state = { ...this.state, stepFinishDisplay: next }
    clientDataStorage.setItem(STORAGE_KEY_STEP_FINISH_DISPLAY, JSON.stringify(next))
    this.emit()
  }

  setCompletedAtFormat(format: CompletedAtFormat) {
    if (this.state.completedAtFormat === format) return
    this.state = { ...this.state, completedAtFormat: format }
    clientDataStorage.setItem(STORAGE_KEY_COMPLETED_AT_FORMAT, format)
    this.emit()
  }

  setReasoningDisplayMode(mode: ReasoningDisplayMode) {
    if (this.state.reasoningDisplayMode === mode) return
    this.state = { ...this.state, reasoningDisplayMode: mode }
    clientDataStorage.setItem(STORAGE_KEY_REASONING_DISPLAY_MODE, mode)
    this.emit()
  }

  setWideMode(enabled: boolean) {
    if (this.state.wideMode === enabled) return
    this.state = { ...this.state, wideMode: enabled }
    clientDataStorage.setItem(STORAGE_KEY_WIDE_MODE, String(enabled))
    this.emit()
  }

  toggleWideMode() {
    this.setWideMode(!this.state.wideMode)
  }

  setDiffStyle(style: DiffStyle) {
    if (this.state.diffStyle === style) return
    this.state = { ...this.state, diffStyle: style }
    clientDataStorage.setItem(STORAGE_KEY_DIFF_STYLE, style)
    this.emit()
  }

  setDescriptiveToolSteps(enabled: boolean) {
    if (this.state.descriptiveToolSteps === enabled) return
    this.state = { ...this.state, descriptiveToolSteps: enabled }
    clientDataStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(enabled))
    this.emit()
  }

  setInlineToolRequests(enabled: boolean) {
    if (this.state.inlineToolRequests === enabled) return
    this.state = { ...this.state, inlineToolRequests: enabled }
    clientDataStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(enabled))
    this.emit()
  }

  setCodeWordWrap(enabled: boolean) {
    if (this.state.codeWordWrap === enabled) return
    this.state = { ...this.state, codeWordWrap: enabled }
    clientDataStorage.setItem(STORAGE_KEY_CODE_WORD_WRAP, String(enabled))
    this.emit()
  }

  setUIFontScale(scale: number) {
    const clamped = clampFontScale(scale)
    if (this.state.uiFontScale === clamped) return
    this.state = { ...this.state, uiFontScale: clamped }
    clientDataStorage.setItem(STORAGE_KEY_FONT_SCALE, String(clamped))
    this.applyFontScale()
    this.emit()
  }

  setCodeFontScale(scale: number) {
    const clamped = clampFontScale(scale)
    if (this.state.codeFontScale === clamped) return
    this.state = { ...this.state, codeFontScale: clamped }
    clientDataStorage.setItem(STORAGE_KEY_CODE_FONT_SCALE, String(clamped))
    this.applyFontScale()
    this.emit()
  }

  setToolCardStyle(style: ToolCardStyle) {
    if (this.state.toolCardStyle === style) return
    this.state = { ...this.state, toolCardStyle: style }
    clientDataStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, style)
    this.emit()
  }

  setImmersiveMode(enabled: boolean) {
    if (this.state.immersiveMode === enabled) return
    this.state = {
      ...this.state,
      immersiveMode: enabled,
      // 鑱斿姩鍥涗釜瀛愬姛鑳?
      inlineToolRequests: enabled,
      descriptiveToolSteps: enabled,
      toolCardStyle: enabled ? 'compact' : 'classic',
      compactInlinePermission: enabled,
    }
    clientDataStorage.setItem(STORAGE_KEY_IMMERSIVE_MODE, String(enabled))
    clientDataStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(enabled))
    clientDataStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(enabled))
    clientDataStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, enabled ? 'compact' : 'classic')
    clientDataStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(enabled))
    this.emit()
  }

  setCompactInlinePermission(enabled: boolean) {
    if (this.state.compactInlinePermission === enabled) return
    this.state = { ...this.state, compactInlinePermission: enabled }
    clientDataStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(enabled))
    this.emit()
  }

  setGlassEffect(enabled: boolean) {
    if (this.state.glassEffect === enabled) return
    this.state = { ...this.state, glassEffect: enabled }
    clientDataStorage.setItem(STORAGE_KEY_GLASS_EFFECT, String(enabled))
    this.applyGlassClass()
    this.emit()
  }

  setQueueFollowupMessages(enabled: boolean) {
    if (this.state.queueFollowupMessages === enabled) return
    this.state = { ...this.state, queueFollowupMessages: enabled }
    clientDataStorage.setItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES, String(enabled))
    this.emit()
  }

  setManualTerminalTitles(enabled: boolean) {
    if (this.state.manualTerminalTitles === enabled) return
    this.state = { ...this.state, manualTerminalTitles: enabled }
    clientDataStorage.setItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES, String(enabled))
    this.emit()
  }

  setExternalFileDropMode(mode: ExternalFileDropMode) {
    if (this.state.externalFileDropMode === mode) return
    this.state = { ...this.state, externalFileDropMode: mode }
    localStorage.setItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE, mode)
    this.emit()
  }

  // ---- Theme Application ----

  /**
   * 从 clientDataStorage 重新加载所有状态并重新应用
   * 在 clientDataStorage.init() 完成云端拉取后调用
   */
  reloadFromCloud() {
    const savedPreset = clientDataStorage.getItem(STORAGE_KEY_PRESET) || DEFAULT_THEME_ID
    const normalizedPreset = getThemePreset(savedPreset) ? savedPreset : DEFAULT_THEME_ID
    const savedMode = (clientDataStorage.getItem(STORAGE_KEY_COLOR_MODE) as ColorMode) || 'system'
    const savedCSS = clientDataStorage.getItem(STORAGE_KEY_CUSTOM_CSS) || ''
    const customCSSSnippets = parseCustomCSSSnippets(clientDataStorage.getItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS))
    const savedActiveCustomCSSSnippetId = clientDataStorage.getItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    const activeCustomCSSSnippetId = customCSSSnippets.some(item => item.id === savedActiveCustomCSSSnippetId)
      ? savedActiveCustomCSSSnippetId
      : null
    const savedCollapse = clientDataStorage.getItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES)
    const collapseUserMessages = savedCollapse === null ? true : savedCollapse === 'true'
    const savedReasoningDisplay = clientDataStorage.getItem(STORAGE_KEY_REASONING_DISPLAY_MODE)
    const reasoningDisplayMode: ReasoningDisplayMode =
      savedReasoningDisplay === 'italic' || savedReasoningDisplay === 'markdown'
        ? savedReasoningDisplay
        : DEFAULT_REASONING_DISPLAY_MODE
    let stepFinishDisplay = DEFAULT_STEP_FINISH_DISPLAY
    try {
      const saved = clientDataStorage.getItem(STORAGE_KEY_STEP_FINISH_DISPLAY)
      if (saved) stepFinishDisplay = { ...DEFAULT_STEP_FINISH_DISPLAY, ...JSON.parse(saved) }
    } catch { /* ignore */ }
    const savedCompletedAtFormat = clientDataStorage.getItem(STORAGE_KEY_COMPLETED_AT_FORMAT)
    const completedAtFormat: CompletedAtFormat =
      savedCompletedAtFormat === 'dateTime' ? 'dateTime' : DEFAULT_COMPLETED_AT_FORMAT
    const savedWideMode = clientDataStorage.getItem(STORAGE_KEY_WIDE_MODE) === 'true'
    const savedDiffStyle = clientDataStorage.getItem(STORAGE_KEY_DIFF_STYLE) as DiffStyle | null
    const diffStyle: DiffStyle = savedDiffStyle === 'changeBars' ? 'changeBars' : DEFAULT_DIFF_STYLE
    const savedDescriptiveToolSteps = clientDataStorage.getItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS)
    const descriptiveToolSteps =
      savedDescriptiveToolSteps === null ? DEFAULT_DESCRIPTIVE_TOOL_STEPS : savedDescriptiveToolSteps === 'true'
    const savedInlineToolRequests = clientDataStorage.getItem(STORAGE_KEY_INLINE_TOOL_REQUESTS)
    const inlineToolRequests =
      savedInlineToolRequests === null ? DEFAULT_INLINE_TOOL_REQUESTS : savedInlineToolRequests === 'true'
    const savedCodeWordWrap = clientDataStorage.getItem(STORAGE_KEY_CODE_WORD_WRAP)
    const codeWordWrap = savedCodeWordWrap === 'true' ? true : DEFAULT_CODE_WORD_WRAP
    const savedFontScale = clientDataStorage.getItem(STORAGE_KEY_FONT_SCALE)
    const uiFontScale = savedFontScale !== null ? clampFontScale(Number(savedFontScale)) : DEFAULT_UI_FONT_SCALE
    const savedCodeFontScale = clientDataStorage.getItem(STORAGE_KEY_CODE_FONT_SCALE)
    const codeFontScale = savedCodeFontScale !== null ? clampFontScale(Number(savedCodeFontScale)) : DEFAULT_CODE_FONT_SCALE
    const savedToolCardStyle = clientDataStorage.getItem(STORAGE_KEY_TOOL_CARD_STYLE) as ToolCardStyle | null
    const toolCardStyle: ToolCardStyle =
      savedToolCardStyle === 'classic' || savedToolCardStyle === 'compact' ? savedToolCardStyle : DEFAULT_TOOL_CARD_STYLE
    const savedImmersiveMode = clientDataStorage.getItem(STORAGE_KEY_IMMERSIVE_MODE)
    const immersiveMode = savedImmersiveMode === 'true' ? true : DEFAULT_IMMERSIVE_MODE
    const savedCompactInlinePermission = clientDataStorage.getItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION)
    const compactInlinePermission =
      savedCompactInlinePermission === null ? DEFAULT_COMPACT_INLINE_PERMISSION : savedCompactInlinePermission === 'true'
    const savedGlassEffect = clientDataStorage.getItem(STORAGE_KEY_GLASS_EFFECT)
    const glassEffect = savedGlassEffect === null ? DEFAULT_GLASS_EFFECT : savedGlassEffect === 'true'
    const savedQueueFollowupMessages = clientDataStorage.getItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES)
    const queueFollowupMessages =
      savedQueueFollowupMessages === null ? DEFAULT_QUEUE_FOLLOWUP_MESSAGES : savedQueueFollowupMessages === 'true'
    const savedManualTerminalTitles = clientDataStorage.getItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES)
    const manualTerminalTitles =
      savedManualTerminalTitles === null ? DEFAULT_MANUAL_TERMINAL_TITLES : savedManualTerminalTitles === 'true'

    const newState: ThemeState = {
      presetId: normalizedPreset,
      colorMode: savedMode,
      customCSS: savedCSS,
      customCSSSnippets,
      activeCustomCSSSnippetId,
      collapseUserMessages,
      stepFinishDisplay,
      completedAtFormat,
      reasoningDisplayMode,
      wideMode: savedWideMode,
      diffStyle,
      descriptiveToolSteps,
      inlineToolRequests,
      codeWordWrap,
      uiFontScale,
      codeFontScale,
      toolCardStyle,
      immersiveMode,
      compactInlinePermission,
      glassEffect,
      queueFollowupMessages,
      manualTerminalTitles,
    }

    // 检查是否真的有变化，避免无效 emit 触发 React 重渲染
    const changed =
      newState.presetId !== this.state.presetId ||
      newState.colorMode !== this.state.colorMode ||
      newState.customCSS !== this.state.customCSS ||
      newState.collapseUserMessages !== this.state.collapseUserMessages ||
      newState.wideMode !== this.state.wideMode ||
      newState.diffStyle !== this.state.diffStyle ||
      newState.descriptiveToolSteps !== this.state.descriptiveToolSteps ||
      newState.inlineToolRequests !== this.state.inlineToolRequests ||
      newState.codeWordWrap !== this.state.codeWordWrap ||
      newState.uiFontScale !== this.state.uiFontScale ||
      newState.codeFontScale !== this.state.codeFontScale ||
      newState.toolCardStyle !== this.state.toolCardStyle ||
      newState.immersiveMode !== this.state.immersiveMode ||
      newState.compactInlinePermission !== this.state.compactInlinePermission ||
      newState.glassEffect !== this.state.glassEffect ||
      newState.queueFollowupMessages !== this.state.queueFollowupMessages ||
      newState.manualTerminalTitles !== this.state.manualTerminalTitles ||
      newState.reasoningDisplayMode !== this.state.reasoningDisplayMode ||
      newState.completedAtFormat !== this.state.completedAtFormat ||
      JSON.stringify(newState.stepFinishDisplay) !== JSON.stringify(this.state.stepFinishDisplay) ||
      JSON.stringify(newState.customCSSSnippets) !== JSON.stringify(this.state.customCSSSnippets) ||
      newState.activeCustomCSSSnippetId !== this.state.activeCustomCSSSnippetId

    if (!changed) {
      console.log('[ThemeStore] reloadFromCloud 无变化，跳过')
      return
    }

    this.state = newState

    console.log('[ThemeStore] 已从云端重新加载主题配置:', this.state.presetId, this.state.colorMode)
    this.applyTheme()
    this.emit()
  }

  /** 鍒濆鍖栵細搴旂敤褰撳墠涓婚鍒?DOM */
  init() {
    this.applyTheme()
    this.applyFontScale()
    this.applyGlassClass()

    // 鐩戝惉绯荤粺涓婚鍙樺寲
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', () => {
      if (this.state.colorMode === 'system') {
        this.applyTheme()
        this.emit()
      }
    })
  }

  /** 灏嗕富棰?CSS 鍙橀噺娉ㄥ叆鍒?DOM */
  applyTheme() {
    const root = document.documentElement
    const resolvedMode = this.getResolvedMode()

    // 1. 璁剧疆 data-mode锛堥┍鍔?CSS 涓棩/澶滄ā寮忕浉鍏崇殑闈為鑹茶鍒欙紝浠ュ強 Terminal銆丼hiki 绛夎仈鍔級
    if (this.state.colorMode === 'system') {
      root.removeAttribute('data-mode')
    } else {
      root.setAttribute('data-mode', this.state.colorMode)
    }

    // 2. 娉ㄥ叆涓婚棰滆壊鍙橀噺
    const preset = this.getPreset()
    if (preset) {
      const colors: ThemeColors = resolvedMode === 'dark' ? preset.dark : preset.light
      this.injectThemeStyle(colors)
    }

    // 3. 搴旂敤鑷畾涔?CSS
    this.applyCustomCSS()

    // 4. 鏇存柊 meta theme-color
    requestAnimationFrame(() => {
      const bg = getComputedStyle(root).getPropertyValue('--color-bg-100').trim()
      if (!bg) return

      // 灏嗚绠楀悗鐨勯鑹茬粺涓€杞负 HEX 鏍煎紡锛岄伩鍏嶄笉鍚屾祻瑙堝櫒/WebView 杩斿洖
      // 涓嶅悓鏍煎紡锛坮gb, oklch, color(srgb ...)锛夊鑷?Android 鍘熺敓绔В鏋愬け璐ユ垨鑹插樊
      const hex = computedColorToHex(bg)
      if (!hex) return

      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', hex)

      const androidBridge = (
        window as unknown as { __opencode_android?: { setSystemBars?: (mode: string, bg: string) => void } }
      ).__opencode_android
      if (androidBridge?.setSystemBars) {
        androidBridge.setSystemBars(resolvedMode, hex)
      }
    })
  }

  private injectThemeStyle(colors: ThemeColors) {
    let el = document.getElementById(STYLE_ID_THEME) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_THEME
      document.head.appendChild(el)
    }

    // 鐢ㄩ珮浼樺厛绾ч€夋嫨鍣ㄨ鐩?:root 涓殑榛樿鍊?
    // 浣跨敤 :root:root 鎻愬崌鐗瑰紓鎬э紝纭繚瑕嗙洊 index.css 涓殑鎵€鏈夊畾涔?
    el.textContent = `:root:root {\n  ${themeColorsToCSSVars(colors)}\n}`
  }

  /**
   * 瀛楀彿鍋忕Щ瑕嗙洊銆?
   * 涓や釜缁村害鍧囦负 0 鏃朵笉娉ㄥ叆瑕嗙洊锛岀洿鎺ョ敤 index.css :root 閲岀殑榛樿鍊笺€?
   * 闈為浂鏃堕€氳繃 :root:root 楂樹紭鍏堢骇瑕嗙洊 --fs-* 鍙橀噺銆?
   *
   * 鍩哄噯鍊硷紙鍋忕Щ 0锛夛細
   *   UI:   xxs=11  xs=12  sm=13  md=13  base=14  lg=16
   *         heading-3=16  heading-2=18  heading-1=20
   *   Code: code=13  code-line-height=24  terminal=13  terminal-line-height=1.4
   */
  private applyFontScale() {
    const { uiFontScale: ui, codeFontScale: code } = this.state
    let el = document.getElementById(STYLE_ID_FONT_SCALE) as HTMLStyleElement | null

    if (ui === 0 && code === 0) {
      if (el) el.remove()
      return
    }

    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_FONT_SCALE
      document.head.appendChild(el)
    }

    const vars: string[] = []

    if (ui !== 0) {
      vars.push(
        `--fs-xxs: ${11 + ui}px`,
        `--fs-xs: ${12 + ui}px`,
        `--fs-sm: ${13 + ui}px`,
        `--fs-md: ${13 + ui}px`,
        `--fs-base: ${14 + ui}px`,
        `--fs-lg: ${16 + ui}px`,
        `--fs-heading-3: ${16 + ui}px`,
        `--fs-heading-2: ${18 + ui}px`,
        `--fs-heading-1: ${20 + ui}px`,
      )
    }

    if (code !== 0) {
      const codePx = 13 + code
      // 琛岄珮 = 鍩哄噯 24 + 鍋忕Щ * 2锛堟瘡 1px 瀛楀彿瀵瑰簲 2px 琛岄珮澧為噺锛?
      const lineH = 24 + code * 2
      const termPx = 13 + code
      const termLH = Math.round((1.4 + code * 0.05) * 100) / 100
      vars.push(
        `--fs-code: ${codePx}px`,
        `--fs-code-line-height: ${lineH}px`,
        `--fs-terminal: ${termPx}px`,
        `--fs-terminal-line-height: ${termLH}`,
      )
    }

    el.textContent = `:root:root {\n  ${vars.join(';\n  ')};\n}`
  }

  private applyCustomCSS() {
    const css = this.state.customCSS.trim()
    let el = document.getElementById(STYLE_ID_CUSTOM) as HTMLStyleElement | null

    if (!css) {
      if (el) el.remove()
      return
    }

    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_CUSTOM
      document.head.appendChild(el)
    }
    el.textContent = css
  }

  /** 姣涚幓鐠冨紑鍏筹細data-glass 灞炴€ч┍鍔?CSS */
  private applyGlassClass() {
    const root = document.documentElement
    if (this.state.glassEffect) {
      root.setAttribute('data-glass', '')
    } else {
      root.removeAttribute('data-glass')
    }
  }

  private persistCustomCSSSnippets(customCSSSnippets: CustomCSSSnippet[]) {
    clientDataStorage.setItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS, JSON.stringify(customCSSSnippets))
  }

  // ---- Subscription (useSyncExternalStore compatible) ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ThemeState => {
    return this.state
  }

  private emit() {
    this.listeners.forEach(fn => fn())
  }
}

// Singleton
export const themeStore = new ThemeStore()

function normalizeThemeBackup(raw: unknown): ThemeBackup {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const customCSSSnippets = parseCustomCSSSnippets(
    JSON.stringify(Array.isArray(parsed?.customCSSSnippets) ? parsed.customCSSSnippets : []),
  )
  const activeCustomCSSSnippetId =
    typeof parsed?.activeCustomCSSSnippetId === 'string' &&
    customCSSSnippets.some(item => item.id === parsed.activeCustomCSSSnippetId)
      ? parsed.activeCustomCSSSnippetId
      : null

  return {
    presetId:
      typeof parsed?.presetId === 'string' && getThemePreset(parsed.presetId) ? parsed.presetId : DEFAULT_THEME_ID,
    colorMode: parsed?.colorMode === 'light' || parsed?.colorMode === 'dark' ? parsed.colorMode : 'system',
    customCSS: typeof parsed?.customCSS === 'string' ? parsed.customCSS : '',
    customCSSSnippets,
    activeCustomCSSSnippetId,
    collapseUserMessages: typeof parsed?.collapseUserMessages === 'boolean' ? parsed.collapseUserMessages : true,
    stepFinishDisplay:
      parsed?.stepFinishDisplay && typeof parsed.stepFinishDisplay === 'object'
        ? { ...DEFAULT_STEP_FINISH_DISPLAY, ...(parsed.stepFinishDisplay as Partial<StepFinishDisplay>) }
        : DEFAULT_STEP_FINISH_DISPLAY,
    completedAtFormat: parsed?.completedAtFormat === 'dateTime' ? 'dateTime' : DEFAULT_COMPLETED_AT_FORMAT,
    reasoningDisplayMode:
      parsed?.reasoningDisplayMode === 'italic' || parsed?.reasoningDisplayMode === 'markdown'
        ? parsed.reasoningDisplayMode
        : DEFAULT_REASONING_DISPLAY_MODE,
    wideMode: parsed?.wideMode === true,
    diffStyle: parsed?.diffStyle === 'changeBars' ? 'changeBars' : DEFAULT_DIFF_STYLE,
    descriptiveToolSteps:
      typeof parsed?.descriptiveToolSteps === 'boolean' ? parsed.descriptiveToolSteps : DEFAULT_DESCRIPTIVE_TOOL_STEPS,
    inlineToolRequests:
      typeof parsed?.inlineToolRequests === 'boolean' ? parsed.inlineToolRequests : DEFAULT_INLINE_TOOL_REQUESTS,
    codeWordWrap: typeof parsed?.codeWordWrap === 'boolean' ? parsed.codeWordWrap : DEFAULT_CODE_WORD_WRAP,
    uiFontScale: clampFontScale(typeof parsed?.uiFontScale === 'number' ? parsed.uiFontScale : DEFAULT_UI_FONT_SCALE),
    codeFontScale: clampFontScale(
      typeof parsed?.codeFontScale === 'number' ? parsed.codeFontScale : DEFAULT_CODE_FONT_SCALE,
    ),
    toolCardStyle:
      parsed?.toolCardStyle === 'classic' || parsed?.toolCardStyle === 'compact'
        ? parsed.toolCardStyle
        : DEFAULT_TOOL_CARD_STYLE,
    immersiveMode: typeof parsed?.immersiveMode === 'boolean' ? parsed.immersiveMode : DEFAULT_IMMERSIVE_MODE,
    compactInlinePermission:
      typeof parsed?.compactInlinePermission === 'boolean'
        ? parsed.compactInlinePermission
        : DEFAULT_COMPACT_INLINE_PERMISSION,
    glassEffect: typeof parsed?.glassEffect === 'boolean' ? parsed.glassEffect : DEFAULT_GLASS_EFFECT,
    queueFollowupMessages:
      typeof parsed?.queueFollowupMessages === 'boolean'
        ? parsed.queueFollowupMessages
        : DEFAULT_QUEUE_FOLLOWUP_MESSAGES,
    manualTerminalTitles:
      typeof parsed?.manualTerminalTitles === 'boolean'
        ? parsed.manualTerminalTitles
        : DEFAULT_MANUAL_TERMINAL_TITLES,
    externalFileDropMode: parsed?.externalFileDropMode === 'mention' ? 'mention' : DEFAULT_EXTERNAL_FILE_DROP_MODE,
  }
}

export function exportThemeBackup(): ThemeBackup {
  const state = themeStore.getState()
  return {
    ...state,
    customCSSSnippets: state.customCSSSnippets.map(item => ({ ...item })),
    stepFinishDisplay: { ...state.stepFinishDisplay },
  }
}

export function importThemeBackup(raw: unknown): void {
  const backup = normalizeThemeBackup(raw)
  clientDataStorage.setItem(STORAGE_KEY_PRESET, backup.presetId)
  clientDataStorage.setItem(STORAGE_KEY_COLOR_MODE, backup.colorMode)
  clientDataStorage.setItem(STORAGE_KEY_CUSTOM_CSS, backup.customCSS)
  clientDataStorage.setItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS, JSON.stringify(backup.customCSSSnippets))
  if (backup.activeCustomCSSSnippetId) {
    clientDataStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, backup.activeCustomCSSSnippetId)
  } else {
    clientDataStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
  }
  clientDataStorage.setItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(backup.collapseUserMessages))
  clientDataStorage.setItem(STORAGE_KEY_STEP_FINISH_DISPLAY, JSON.stringify(backup.stepFinishDisplay))
  clientDataStorage.setItem(STORAGE_KEY_COMPLETED_AT_FORMAT, backup.completedAtFormat)
  clientDataStorage.setItem(STORAGE_KEY_REASONING_DISPLAY_MODE, backup.reasoningDisplayMode)
  clientDataStorage.setItem(STORAGE_KEY_WIDE_MODE, String(backup.wideMode))
  clientDataStorage.setItem(STORAGE_KEY_DIFF_STYLE, backup.diffStyle)
  clientDataStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(backup.descriptiveToolSteps))
  clientDataStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(backup.inlineToolRequests))
  clientDataStorage.setItem(STORAGE_KEY_CODE_WORD_WRAP, String(backup.codeWordWrap))
  clientDataStorage.setItem(STORAGE_KEY_FONT_SCALE, String(backup.uiFontScale))
  clientDataStorage.setItem(STORAGE_KEY_CODE_FONT_SCALE, String(backup.codeFontScale))
  clientDataStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, backup.toolCardStyle)
  clientDataStorage.setItem(STORAGE_KEY_IMMERSIVE_MODE, String(backup.immersiveMode))
  clientDataStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(backup.compactInlinePermission))
  clientDataStorage.setItem(STORAGE_KEY_GLASS_EFFECT, String(backup.glassEffect))
  clientDataStorage.setItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES, String(backup.queueFollowupMessages))
  clientDataStorage.setItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES, String(backup.manualTerminalTitles))
  clientDataStorage.setItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE, backup.externalFileDropMode)
}
