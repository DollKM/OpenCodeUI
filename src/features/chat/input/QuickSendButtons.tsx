import { memo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SendIcon } from '../../../components/Icons'
import type { Attachment } from '../../attachment'

const QUICK_SEND_BUTTONS = ['recommend', 'continue', 'confirm', 'whatDoYouThink'] as const

interface QuickSendButtonsProps {
  onSend: (text: string, attachments: Attachment[], options?: { agent?: string; variant?: string }) => Promise<boolean> | boolean
  sessionId?: string | null
  isStreaming?: boolean
  selectedAgent?: string
  selectedVariant?: string
}

export const QuickSendButtons = memo(function QuickSendButtons({
  onSend,
  sessionId,
  isStreaming = false,
  selectedAgent,
  selectedVariant,
}: QuickSendButtonsProps) {
  const { t } = useTranslation('chat')
  const lastClickRef = useRef<Record<string, number>>({})

  const handleClick = useCallback(
    (key: (typeof QUICK_SEND_BUTTONS)[number]) => {
      const now = Date.now()
      const last = lastClickRef.current[key] || 0
      if (now - last < 500) return
      lastClickRef.current[key] = now

      const text = t(`quickSendButtons.${key}`)
      void onSend(text, [], { agent: selectedAgent, variant: selectedVariant })
    },
    [onSend, selectedAgent, selectedVariant, t],
  )

  if (!sessionId || isStreaming) return null

  return (
    <div className="flex items-center gap-1.5">
      {QUICK_SEND_BUTTONS.map(key => (
        <button
          key={key}
          type="button"
          onClick={() => handleClick(key)}
          className="flex items-center gap-1 px-2.5 h-[32px] rounded-full bg-accent-main-100/10 backdrop-blur-md border border-accent-main-100/20 text-[length:var(--fs-sm)] leading-[14px] text-text-200 hover:bg-accent-main-100/20 hover:text-text-100 transition-colors whitespace-nowrap shrink-0"
        >
          <span>{t(`quickSendButtons.${key}`)}</span>
          <SendIcon size={12} />
        </button>
      ))}
    </div>
  )
})
