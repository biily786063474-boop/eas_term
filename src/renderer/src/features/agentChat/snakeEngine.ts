export type Point = [number, number]
export type Game = {cells:Point[];direction:Point;next:Point;food:Point;score:number;mode:'idle'|'running'|'paused'|'ended'}
export function newGame(): Game {return {cells:[[6,8],[5,8],[4,8]],direction:[1,0],next:[1,0],food:[12,8],score:0,mode:'idle'}}
export function toggle(g:Game):Game {return g.mode==='idle'||g.mode==='ended'?{...newGame(),mode:'running'}:{...g,mode:g.mode==='running'?'paused':'running'}}
export function turn(g:Game,d:Point):Game {return d[0]===-g.direction[0]&&d[1]===-g.direction[1]?g:{...g,next:d}}
export function tick(g:Game):Game {
 if(g.mode!=='running')return g
 const head:Point=[g.cells[0][0]+g.next[0],g.cells[0][1]+g.next[1]]
 const eat=head[0]===g.food[0]&&head[1]===g.food[1]
 if(head.some(v=>v<0||v>=16)||g.cells.slice(0,eat?g.cells.length:-1).some(p=>p[0]===head[0]&&p[1]===head[1]))return {...g,mode:'ended'}
 const cells=[head,...g.cells];if(!eat)cells.pop()
 const free:Point[]=[];if(eat)for(let x=0;x<16;x++)for(let y=0;y<16;y++)if(!cells.some(p=>p[0]===x&&p[1]===y))free.push([x,y])
 return {...g,cells,direction:g.next,food:eat&&free.length?free[Math.floor(Math.random()*free.length)]:g.food,score:g.score+(eat?1:0),mode:eat&&!free.length?'ended':'running'}
}
