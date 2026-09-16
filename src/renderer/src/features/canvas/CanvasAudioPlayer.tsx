import { useState } from 'react'
import { MusicIcon } from '../../ui/Icons'
import { easfileUrl } from './media'

// 画布音频节点：图标 + 文件名 + 原生 <audio> 播放条。
// Chromium 能解 mp3 / wav / m4a / aac / flac / ogg / opus；.aiff 这类它不支持，
// 加载会 error —— 那时给一句友好提示，别把坏掉的播放器晾在那儿。
// 抽成组件是因为 Frame 内节点（CanvasFileNode）和自由节点（CanvasFreeFileNode）两条渲染路
// 都要用，内联两份必然分叉。
export function CanvasAudioPlayer({ filePath }: { filePath: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  return (
    <div className="cfile-audio">
      <MusicIcon size={28} />
      <div className="cfile-audio-name">{filePath.split('/').pop()}</div>
      <audio
        className="cfile-audio-player"
        src={easfileUrl(filePath)}
        controls
        onError={() => setFailed(true)}
      />
      {failed && <div className="cfile-audio-err">此音频格式无法在这里播放</div>}
    </div>
  )
}
