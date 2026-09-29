import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n.ts'
import { newGame, tick, toggle, turn, type Point } from './snakeEngine'

export function SetupSnake({onClose}:{onClose:()=>void}):React.JSX.Element {
 const t=useT()
 const [game,setGame]=useState(newGame)
 const panel=useRef<HTMLDivElement>(null)
 const closeRef=useRef(onClose);closeRef.current=onClose
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null
  panel.current?.focus()
  const key=(e:KeyboardEvent):void=>{
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeRef.current();return}
   if(e.key==='Tab'){const nodes=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button')??[]);const first=nodes[0],last=nodes.at(-1);if(!nodes.includes(document.activeElement as HTMLButtonElement)||(!e.shiftKey&&document.activeElement===last)){e.preventDefault();first?.focus()}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}return}
   const d:Point|undefined=({ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]} as Record<string,Point>)[e.key]
   if(d){e.preventDefault();e.stopImmediatePropagation();setGame(g=>turn(g,d))}
  }
  // Document capture runs before the setup window listener.
  window.addEventListener('keydown',key,true)
  return ()=>{window.removeEventListener('keydown',key,true);previous?.isConnected&&previous.focus()}
 },[])
 useEffect(()=>{if(game.mode!=='running')return;const t=window.setInterval(()=>setGame(tick),180);return ()=>window.clearInterval(t)},[game.mode])
 return createPortal(<div className="ac-setup-mask ac-snake-mask"><div className="ac-setup ac-snake" role="dialog" aria-modal="true" aria-label={t('chat.snake.title')} tabIndex={-1} ref={panel}>
  <div className="ac-login-head"><strong>{t('chat.snake.title')}</strong><button className="ac-login-retry" onClick={onClose}>{t('chat.snake.back')}</button></div>
  <svg className="ac-snake-board" viewBox="0 0 320 320" role="img" aria-label={t('chat.snake.ariaScore',{n:game.score})}>
   <rect className="ac-snake-food" x={game.food[0]*20+5} y={game.food[1]*20+5} width="10" height="10" rx="2"/>
   {game.cells.map((p,i)=><rect key={i} className={i?'ac-snake-body':'ac-snake-head'} x={p[0]*20+2} y={p[1]*20+2} width="16" height="16" rx="3"/>)}
   {game.mode!=='running'&&<><rect className="ac-snake-scrim" width="320" height="320"/><text x="160" y="148" textAnchor="middle">{game.mode==='idle'?t('chat.snake.ready'):game.mode==='ended'?t('chat.snake.ended'):t('chat.snake.paused')}</text></>}
  </svg>
  <div className="ac-setup-row ac-snake-controls"><span>{t('chat.snake.score',{n:game.score})}</span><button className="ac-login-go" onClick={()=>setGame(toggle)}>{game.mode==='idle'?t('chat.snake.start'):game.mode==='running'?t('chat.snake.pause'):game.mode==='paused'?t('chat.snake.resume'):t('chat.snake.again')}</button></div>
  <p className="ac-login-hint">{t('chat.snake.hint1')}<br/>{t('chat.snake.hint2')}</p>
 </div></div>,document.body)
}
