"use client"

interface ExitDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

export function ExitDialog({ onConfirm, onCancel }: ExitDialogProps) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
      <div className="bg-[#d4d0c8] p-1 win-border">
        <div 
          className="h-6 flex items-center justify-between px-2 text-white text-[11px] font-bold"
          style={{ background: 'linear-gradient(90deg, #000080, #1084d0)' }}
        >
          <span>记事本</span>
          <button onClick={onCancel} className="text-white hover:bg-[#c00000] px-1">✕</button>
        </div>
        <div className="p-4 bg-[#d4d0c8]">
          <div className="flex gap-3 items-start mb-4">
            <div className="text-2xl">❓</div>
            <div className="text-[12px]">
              <p>确定要退出记事本吗？</p>
              <p className="text-[11px] text-[#808080] mt-1">您的笔记已自动保存到本地。</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onConfirm} className="win-button text-[11px] px-4 py-1">
              确定
            </button>
            <button onClick={onCancel} className="win-button text-[11px] px-4 py-1">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
