import {DISTRIBUTION,SIZE,applyMove,removeRackTiles} from './game.js'

const panel=document.querySelector('#threatPanel')
const status=document.querySelector('#threatStatus')
const board=document.querySelector('#board')
const tip=document.createElement('div')
tip.id='heatTooltip';tip.className='heat-tooltip';tip.hidden=true;tip.setAttribute('role','tooltip')
document.body.append(tip)
let worker=null,request=0,key='',timer=null,context=null,results={},mode='both',active=null,pinned=false
const sides=()=>mode==='both'?['you','opponent']:mode==='off'?[]:[mode]
const coord=i=>`${String.fromCharCode(65+i%SIZE)}${Math.floor(i/SIZE)+1}`
const percent=(hits,result,exact)=>`${exact?'':'≈'}${Math.round(hits/result.samples*100)}%`
const hue=score=>Math.max(0,120-score*1.2)
function unavailable(){status.textContent='Unavailable';panel.removeAttribute('aria-busy')}
export function initThreats(words){
  if(!('Worker' in window)){unavailable();return}
  try{
    worker=new Worker(new URL('./threat-worker.js',import.meta.url),{type:'module'})
    worker.onmessage=({data})=>{
      if(data.id!==request)return
      results[data.side]=data
      const busy=sides().some(side=>!results[side]?.done&&!results[side]?.error)
      status.textContent=busy?'•••':sides().some(side=>results[side]?.error)?'!':sides().every(side=>results[side]?.exact)?'Exact':'≈'
      status.setAttribute('aria-label',busy?'Sampling racks':sides().some(side=>results[side]?.error)?'Some estimates unavailable':'Estimates ready')
      panel.setAttribute('aria-busy',String(busy))
      paint()
    }
    worker.onerror=()=>{worker?.terminate();worker=null;unavailable()}
    worker.postMessage({type:'init',words})
  }catch{unavailable()}
}
function hideTip(){
  active=null;pinned=false;tip.hidden=true
  board.querySelectorAll('.opponent-ghost').forEach(el=>el.remove())
  board.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))
}
function positionTip(){
  if(active===null||tip.hidden)return
  const rect=board.children[active.index].getBoundingClientRect(),width=tip.offsetWidth,height=tip.offsetHeight
  tip.style.left=`${Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2))}px`
  const top=rect.top-height-12
  tip.style.top=`${Math.max(8,Math.min(innerHeight-height-8,top>=8?top:rect.bottom+12))}px`
}
function showTip(index,side){
  const {result,exact}=results[side]||{}
  if(!result?.hits[index])return
  active={index,side}
  tip.dataset.side=side
  const score=Math.round(result.scores[index]/result.hits[index]),move=result.examples[index]
  const phase=side==='you'?(context.preview?'Refill · no opponent reply':'Current rack'):(context.preview?'After preview':'Current board')
  tip.innerHTML=`<header><b>${side==='you'?'You':'Opponent'} <span>${coord(index)}</span></b><small>${phase}</small></header><div class="heat-metrics"><div><strong>${percent(result.hits[index],result,exact)}</strong><span>Chance</span></div><div><strong style="color:hsl(${hue(score)} 75% 72%)">${score}<small> pts</small></strong><span>Avg best · if available</span></div></div><footer><span>Example <b>${move.word}</b></span><strong>${move.score} pts</strong></footer><small class="heat-sample">${exact?'Exact rack':`${result.samples} samples · estimated`}</small>`
  tip.hidden=false
  board.querySelectorAll('.opponent-ghost').forEach(el=>el.remove())
  board.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))
  board.children[index].querySelector(`[data-side="${side}"].heat-hit`)?.setAttribute('aria-describedby',tip.id)
  for(const p of move.placements){
    const tile=document.createElement('span');tile.className='opponent-ghost';tile.dataset.side=side;tile.textContent=p.letter+(p.blank?'·':'')
    board.children[p.r*SIZE+p.c]?.append(tile)
  }
  positionTip()
}
function clearPaint(){
  hideTip()
  board.querySelectorAll('.heat-hit').forEach(el=>el.remove())
  for(const cell of board.children)if(cell.dataset.heatTitle!==undefined){cell.title=cell.dataset.heatTitle;delete cell.dataset.heatTitle}
}
function paint(){
  board.classList.toggle('heat-both',mode==='both')
  for(const side of sides()){
  const {result,exact}=results[side]||{}
  if(!result)continue
  for(let i=0;i<result.hits.length;i++){
    const cell=board.children[i]
    if(!cell)continue
    // Suppress native board titles too, so only the instant card appears.
    if(cell.hasAttribute('title')){cell.dataset.heatTitle=cell.title;cell.removeAttribute('title')}
    if(!result.hits[i])continue
    let button=cell.querySelector(`[data-side="${side}"].heat-hit`)
    if(!button){
      button=document.createElement('button');button.className='heat-hit';button.dataset.side=side
      button.innerHTML='<i aria-hidden="true"></i>'
      button.onpointerenter=e=>{if(e.pointerType!=='touch'&&!pinned)showTip(i,side)}
      button.onpointerleave=()=>{if(!pinned)hideTip()}
      button.onfocus=()=>{if(!pinned)showTip(i,side)}
      button.onblur=()=>{if(!pinned)hideTip()}
      button.onclick=()=>{if(pinned&&active?.index===i&&active?.side===side)hideTip();else{pinned=true;showTip(i,side)}}
      cell.append(button)
    }
    const probability=result.hits[i]/result.samples,score=result.scores[i]/result.hits[i]
    button.style.setProperty('--diameter',`${20+70*Math.sqrt(probability)}%`)
    button.style.setProperty('--hue',hue(score))
    button.setAttribute('aria-label',`${side==='you'?'You':'Opponent'}, ${coord(i)}: ${percent(result.hits[i],result,exact)} chance; ${Math.round(score)} points average best when available`)
  }
  }
  if(active!==null)showTip(active.index,active.side)
}
export function updateThreats(state,selected,myId){
  context=state?{state,preview:selected,myId}:null
  panel.classList.toggle('hidden',!state||state.status!=='playing')
  const mine=state?.players.find(p=>p.id===myId)
  const next=state&&state.status==='playing'&&mode!=='off'?JSON.stringify([mode,myId,state.revision,state.board,mine?.rack,selected?.placements]):''
  if(next===key){paint();return}
  key=next;request++;clearTimeout(timer);worker?.postMessage({type:'cancel'})
  results={};clearPaint();panel.removeAttribute('aria-busy')
  if(!next){status.textContent='';return}
  if(selected&&state.bagCount===0&&selected.placements.length===mine?.rack.length){status.textContent='Finished';return}
  status.textContent='•••';panel.setAttribute('aria-busy','true')
  const counts={...DISTRIBUTION}
  for(const row of state.board)for(const tile of row)if(tile)counts[tile.blank?'?':tile.letter]--
  for(const tile of mine?.rack||[])counts[tile]--
  const pool=Object.entries(counts).flatMap(([letter,n])=>Array(Math.max(0,n)).fill(letter))
  const id=request
  timer=setTimeout(()=>{
    if(!worker){unavailable();return}
    for(const side of sides()){
      const kept=side==='you'?(selected?removeRackTiles(mine?.rack||[],selected.placements):mine?.rack||[]):[]
      // These are marginal opportunities, not a joint simulation of both turns.
      const size=side==='you'?(selected?Math.min(state.bagCount,7-kept.length):0):state.players.find(p=>p.id!==myId)?.rackCount||0
      worker.postMessage({id,side,board:selected?applyMove(state.board,selected.placements):state.board,pool,size,kept})
    }
  },120)
}
panel.onclick=e=>{
  const button=e.target.closest('[data-heat-mode]')
  if(!button)return
  mode=button.dataset.heatMode
  panel.querySelectorAll('[data-heat-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)))
  if(context)updateThreats(context.state,context.preview,context.myId)
}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.heat-hit'))hideTip()})
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip()})
window.addEventListener('resize',positionTip)
window.addEventListener('scroll',positionTip,true)
