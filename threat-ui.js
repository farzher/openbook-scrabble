import {SIZE,applyMove,removeRackTiles} from './game.js'
import {unseenPool} from './threats.js?v=ev-cache1'
import {dualCloudPixels} from './heatmap.js?v=ev-cache1'

const panel=document.querySelector('#threatPanel')
const status=document.querySelector('#threatStatus')
const phase=document.querySelector('#threatPhase')
const board=document.querySelector('#board')
const evYou=document.querySelector('#boardEvYou')
const evOpponent=document.querySelector('#boardEvOpponent')
const evOpponentLabel=document.querySelector('#boardEvOpponentLabel')
const toggle=document.querySelector('#heatToggle')

const tip=document.createElement('div')
tip.id='heatTooltip'
tip.className='heat-tooltip'
tip.hidden=true
tip.setAttribute('role','tooltip')
panel?.append(tip)

let worker=null,request=0,key='',resultsKey='',timer=null,context=null,results={},pending={},active=null
let enabled=true,painted=null,cacheTurn='',cache=new Map()
const SIDES=['you','opponent']
const CACHE_LIMIT=96
const canvas=document.createElement('canvas')
canvas.width=canvas.height=240
const brush=canvas.getContext('2d')

const coord=i=>`${String.fromCharCode(65+i%SIZE)}${Math.floor(i/SIZE)+1}`
const evAt=(result,index)=>result?.samples?(result.scores?.[index]||0)/result.samples:0
const boardEv=result=>result?.samples?(result.bestTotal||0)/result.samples:null
const sidePhase=side=>{
  if(side==='you')return context?.preview?'After refill':'Current rack'
  return context?.preview?'Reply to preview':'Possible rack'
}
const ready=data=>!!(data?.result?.samples||data?.error)
const complete=data=>!!(data?.done||data?.error)

toggle?.addEventListener('click',()=>{
  enabled=!enabled
  toggle.setAttribute('aria-pressed',String(enabled))
  toggle.title=enabled?'Hide EV heatmap':'Show EV heatmap'
  hideTip()
  if(enabled){
    ensureHeatShell()
    paint()
  }else{
    hideHeatmap()
  }
})

function setStatus(state,label=''){
  if(!status)return
  status.dataset.state=state
  status.textContent=state==='error'?'!':''
  status.title=label
  status.setAttribute('aria-label',label)
  panel?.toggleAttribute('aria-busy',state==='busy')
}
function unavailable(message='EV unavailable'){
  setStatus('error',message)
  board?.classList.remove('heat-loading')
}
export function initThreats(words){
  if(!panel||!status||!board)return
  if(!('Worker' in window)){unavailable();return}
  try{
    worker=new Worker(new URL('./threat-worker.js?v=ev-cache1',import.meta.url),{type:'module'})
    worker.onmessage=({data})=>{
      if(data.id!==request)return
      pending[data.side]=data

      // Do not replace the previous map with a half-new one. Once both sides
      // have data, promote them together and refine from there.
      if(SIDES.every(side=>ready(pending[side]))){
        results={...pending}
        resultsKey=key
        paint()
        renderBoardEv()
      }
      updateStatus()

      if(SIDES.every(side=>complete(pending[side]))){
        remember(key,resultsKey===key?results:{...pending})
        board.classList.remove('heat-loading')
      }
    }
    worker.onerror=event=>{
      console.error('EV worker failed',event)
      worker?.terminate();worker=null
      unavailable()
    }
    worker.postMessage({type:'init',words})
  }catch(error){
    console.error('EV worker unavailable',error)
    unavailable()
  }
}

function remember(cacheKey,value){
  if(!cacheKey||!SIDES.every(side=>value?.[side]))return
  if(cache.has(cacheKey))cache.delete(cacheKey)
  cache.set(cacheKey,value)
  while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value)
}
function resetTurnCache(turnKey){
  if(cacheTurn===turnKey)return
  cacheTurn=turnKey
  cache.clear()
}
function updateStatus(){
  const failed=SIDES.some(side=>pending[side]?.error)
  const busy=!SIDES.every(side=>complete(pending[side]))
  if(failed)setStatus('error','Some EV data is unavailable')
  else if(busy)setStatus('busy',resultsKey===key?'Refining EV':'Calculating EV')
  else setStatus('ready','')
}
function ensureHeatShell(){
  if(!enabled||!board)return
  board.classList.add('heat-cloud')
  if(resultsKey!==key)board.classList.add('heat-loading')
}
function hideHeatmap(){
  board.classList.remove('heat-cloud','heat-loading')
  board.style.removeProperty('background-image')
  painted=null
  restoreTitles()
}
function restoreTitles(){
  for(const cell of board.children){
    if(cell.dataset.heatTitle!==undefined){
      cell.title=cell.dataset.heatTitle
      delete cell.dataset.heatTitle
    }
  }
}
function hideTip(){
  active=null
  if(tip)tip.hidden=true
  panel?.classList.remove('inspecting')
  board?.querySelectorAll('.forecast-focus').forEach(el=>el.classList.remove('forecast-focus'))
  board?.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))
}
function showTip(index){
  if(resultsKey!==key||!SIDES.some(side=>results[side]?.result?.samples)){hideTip();return}
  active={index}
  const opponent=context?.state?.players.find(p=>p.id!==context.myId)
  const youEv=results.you?.result?.samples?evAt(results.you.result,index):null
  const oppEv=results.opponent?.result?.samples?evAt(results.opponent.result,index):null
  tip.innerHTML=`<div class="heat-tip-square"><b>${coord(index)}</b><span>Square EV</span></div>
    <div class="heat-tip-player you"><span>You</span><strong>${youEv===null?'—':youEv.toFixed(1)}</strong></div>
    <i class="heat-tip-vs">vs</i>
    <div class="heat-tip-player opponent"><span>${opponent?.name||'Opponent'}</span><strong>${oppEv===null?'—':oppEv.toFixed(1)}</strong></div>`
  panel?.classList.add('inspecting')
  tip.hidden=false
  board.querySelectorAll('.forecast-focus').forEach(el=>el.classList.remove('forecast-focus'))
  board.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))
  const cell=board.children[index]
  cell?.classList.add('forecast-focus')
  cell?.setAttribute('aria-describedby',tip.id)
}
function renderBoardEv(){
  if(!evYou||!evOpponent)return
  const you=boardEv(results.you?.result),opp=boardEv(results.opponent?.result)
  evYou.textContent=you===null?'—':you.toFixed(1)
  evOpponent.textContent=opp===null?'—':opp.toFixed(1)
  const opponent=context?.state?.players.find(p=>p.id!==context.myId)
  if(evOpponentLabel)evOpponentLabel.textContent=opponent?.name||'Opponent'
  panel.classList.toggle('ev-stale',resultsKey!==key)
}
function paint(){
  if(!board||!enabled)return
  ensureHeatShell()
  const pair=SIDES.map(side=>results[side]?.result)
  if(resultsKey!==key||!pair.some(result=>result?.samples)||!brush)return

  if(!painted||pair.some((result,i)=>result!==painted[i])){
    const values=pair.map(result=>result?.samples?result.scores.map(score=>score/result.samples):Array(SIZE*SIZE).fill(0))
    const image=brush.createImageData(240,240)
    image.data.set(dualCloudPixels(...values))
    brush.putImageData(image,0,0)
    board.style.backgroundImage=`url("${canvas.toDataURL()}")`
    painted=pair
  }
  board.classList.remove('heat-loading')
  for(const cell of board.children){
    if(cell.hasAttribute('title')){cell.dataset.heatTitle=cell.title;cell.removeAttribute('title')}
  }
  if(active!==null)showTip(active.index)
}
function analysisKey(state,selected,myId){
  if(!state||state.status!=='playing')return''
  const preview=selected?.placements
    ?.map(p=>`${p.r},${p.c},${p.letter},${p.blank?1:0}`)
    .sort()
    .join(';')||'base'
  return `${myId}|${state.revision}|${preview}`
}

export function updateThreats(state,selected,myId){
  if(!panel||!status||!board)return
  context=state?{state,preview:selected,myId}:null
  panel.classList.toggle('hidden',!state||state.status!=='playing')
  if(phase)phase.textContent=selected?'after preview':''

  if(!state||state.status!=='playing'){
    key=''
    resultsKey=''
    results={}
    pending={}
    hideTip()
    hideHeatmap()
    renderBoardEv()
    setStatus('ready','')
    return
  }

  resetTurnCache(`${myId}|${state.revision}`)
  const next=analysisKey(state,selected,myId)
  if(next===key){
    ensureHeatShell()
    paint()
    renderBoardEv()
    return
  }

  key=next
  request++
  clearTimeout(timer)
  worker?.postMessage({type:'cancel'})
  pending={}
  hideTip()

  // Keep the previously-rendered cloud while the new position is calculated.
  // On the first analysis, enter the dark heatmap shell immediately.
  ensureHeatShell()
  panel.classList.add('ev-stale')
  setStatus('busy','Calculating EV')

  const cached=cache.get(key)
  if(cached){
    results=cached
    resultsKey=key
    pending={...cached}
    painted=null
    paint()
    renderBoardEv()
    panel.classList.remove('ev-stale')
    setStatus('ready','')
    return
  }

  const mine=state.players.find(p=>p.id===myId)
  if(selected&&state.bagCount===0&&selected.placements.length===mine?.rack.length){
    setStatus('ready','Game ending')
    return
  }

  // Played tiles remain unavailable to both hypothetical racks.
  const pool=unseenPool(state.board,mine?.rack||[])
  const id=request
  timer=setTimeout(()=>{
    if(!worker){unavailable();return}
    for(const side of SIDES){
      const kept=side==='you'
        ?(selected?removeRackTiles(mine?.rack||[],selected.placements):mine?.rack||[])
        :[]
      const size=side==='you'
        ?(selected?Math.min(state.bagCount,7-kept.length):0)
        :state.players.find(p=>p.id!==myId)?.rackCount||0
      worker.postMessage({
        id,
        side,
        board:selected?applyMove(state.board,selected.placements):state.board,
        pool,
        size,
        kept
      })
    }
  },70)
}

board?.addEventListener('pointermove',e=>{
  const cell=e.target.closest('.cell')
  if(!cell)return
  const index=Number(cell.dataset.r)*SIZE+Number(cell.dataset.c)
  if(enabled)showTip(index)
  else hideTip()
})
board?.addEventListener('pointerleave',hideTip)
board?.addEventListener('focusin',e=>{
  const cell=e.target.closest('.cell')
  if(cell&&enabled)showTip(Number(cell.dataset.r)*SIZE+Number(cell.dataset.c))
})
board?.addEventListener('focusout',hideTip)
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#board'))hideTip()})
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip()})
