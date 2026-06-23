"use client"

import { Note } from '@/hooks/use-notes'

interface NoteListViewProps {
  notes: Note[]
  selectedNote: Note | null
  onSelectNote: (note: Note) => void
  onViewNote: (note: Note) => void
  onDeleteNote?: (note: Note) => void
}

export function NoteListView({ 
  notes, 
  selectedNote, 
  onSelectNote,
  onViewNote,
  onDeleteNote
}: NoteListViewProps) {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 表头 */}
      <div className="flex bg-[#d4d0c8] border-b border-[#808080] text-[11px] font-bold">
        <div className="w-12 p-1 border-r border-[#808080] text-center">#</div>
        <div className="flex-1 p-1 border-r border-[#808080]">标题</div>
        <div className="w-20 p-1 border-r border-[#808080]">分类</div>
        <div className="w-36 p-1 border-r border-[#808080]">创建时间</div>
        <div className="w-20 p-1 text-center">操作</div>
      </div>
      
      {/* 列表内容 */}
      <div className="flex-1 bg-white win-inset overflow-auto">
        {notes.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-[#808080]">
            暂无笔记，请点击 [3] 新建笔记 创建
          </div>
        ) : (
          notes.map((note, index) => (
            <div
              key={note.id}
              onClick={() => onSelectNote(note)}
              onDoubleClick={() => onViewNote(note)}
              className={`flex text-[11px] border-b border-[#d4d0c8] cursor-pointer ${
                selectedNote?.id === note.id 
                  ? 'bg-[#000080] text-white' 
                  : 'hover:bg-[#ece9d8]'
              }`}
            >
              <div className="w-12 p-1 border-r border-[#d4d0c8] text-center">
                {index + 1}
              </div>
              <div className="flex-1 p-1 border-r border-[#d4d0c8] truncate">
                {note.title}
              </div>
              <div className="w-20 p-1 border-r border-[#d4d0c8] truncate">
                {note.category}
              </div>
              <div className="w-36 p-1 border-r border-[#d4d0c8] truncate">
                {formatDate(note.createdAt)}
              </div>
              <div className="w-20 p-1 flex justify-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onViewNote(note)
                  }}
                  className={`text-[10px] px-1 ${
                    selectedNote?.id === note.id 
                      ? 'text-white hover:underline' 
                      : 'text-[#000080] hover:underline'
                  }`}
                >
                  查看
                </button>
                {onDeleteNote && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteNote(note)
                    }}
                    className={`text-[10px] px-1 ${
                      selectedNote?.id === note.id 
                        ? 'text-white hover:underline' 
                        : 'text-[#c00000] hover:underline'
                    }`}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* 状态栏 */}
      <div className="p-1 bg-[#d4d0c8] border-t border-[#808080] text-[10px]">
        {selectedNote 
          ? `已选择: ${selectedNote.title} | 双击打开查看`
          : '单击选择笔记，双击打开查看'}
      </div>
    </div>
  )
}
