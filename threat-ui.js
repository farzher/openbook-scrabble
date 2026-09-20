import {SIZE,applyMove,removeRackTiles,keyOfMove} from './game.js'
import {unseenPool} from './threats.js?v=ev-concurrent1'
import {dualCloudPixels} from './heatmap.js?v=ev-concurrent1'

const panel=document.querySelector('#threatPanel')
const status=document.querySelector('#threatStatus')
const phase=document.querySelector('#threatPhase')
const board=document.querySelector('#board')
const evYou=document.querySelector('#boardEvYou')
const evOpponent=document.querySelector('#boardEvOpponent')
const toggle=document.querySelector('#heatToggle')

const tip=document.createElement('div')
tip.id='heatTooltip'
tip.className='heat-tooltip'
tip.hidden=true
tip.setAttribute('role','tooltip')
panel?.append(tip)

let worker=null,request=0,key='',resultsKey='',context=null,results={},pending={},active=null
let enabled=true,painted=null,cacheTurn='',cache=new Map(),jobs=new Map()
let bgWorkers=[],bgQueue=[],bgQueued=new Set()
const SIDES=['you','opponent']
const CACHE_LIMIT=96
const PREFETCH_LIMIT=18
const BG_WORKERS=(navigator.hardwareConcurrency||4)<=4?1:(navigator.hardwareConcurrency||4)<=8?2:3
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
function emitMoveEv(entry){
  if(!entry?.moveKey||!SIDES.every(side=>entry.sides[side]?.result?.samples))return
  const you=boardEv(entry.sides.you.result),opponent=boardEv(entry.sides.opponent.result)
  if(you===null||opponent===null)return
  document.dispatchEvent(new CustomEvent('openbook-move-ev',{detail:{
    revision:entry.revision,moveKey:entry.moveKey,you,opponent,diff:you-opponent,
    samples:Math.min(entry.sides.you.result.samples,entry.sides.opponent.result.samples),
    done:SIDES.every(side=>complete(entry.sides[side]))
  }}))
}
function handleWorkerResult(data,jobKey){
  if(!jobKey)return false
  const entry=cache.get(jobKey)
  if(!entry)return false

  entry.sides[data.side]=data
  entry.updated=performance.now()
  touchCache(jobKey,entry)
  emitMoveEv(entry)

  if(jobKey===key){
    pending=entry.sides
    if(SIDES.every(side=>ready(pending[side]))){
      results={...pending}
      resultsKey=key
      painted=null
      paint()
      renderBoardEv()
    }
    updateStatus(entry)
  }

  if(SIDES.every(side=>complete(entry.sides))){
    entry.done=true
    if(jobKey===key)board.classList.remove('heat-loading')
    return true
  }
  return false
}
function makeBackgroundWorker(words){
  const slot={worker:null,busy:false,id:0,key:''}
  try{
    slot.worker=new Worker(new URL('./threat-worker.js?v=ev-prefetch1',import.meta.url),{type:'module'})
    slot.worker.onmessage=({data})=>{
      if(data.id!==slot.id)return
      const done=handleWorkerResult(data,slot.key)
      if(done){
        slot.busy=false
        slot.id=0
        slot.key=''
        pumpBackground()
      }
    }
    slot.worker.onerror=event=>{
      console.error('Background EV worker failed',event)
      slot.worker?.terminate()
      slot.worker=null
      slot.busy=false
    }
    slot.worker.postMessage({type:'init',words})
  }catch(error){
    console.error('Background EV worker unavailable',error)
  }
  return slot
}
function pumpBackground(){
  for(const slot of bgWorkers){
    if(slot.busy||!slot.worker)continue
    let job
    while((job=bgQueue.shift())){
      bgQueued.delete(job.key)
      if(job.turnKey!==cacheTurn||cache.has(job.key))continue
      break
    }
    if(!job)continue

    const id=++request
    const entry={id,sides:{},done:false,updated:performance.now(),moveKey:job.moveKey,revision:job.revision,background:true}
    touchCache(job.key,entry)
    slot.busy=true
    slot.id=id
    slot.key=job.key

    for(const side of SIDES){
      const payload=job.payloads[side]
      slot.worker.postMessage({id,side,...payload,reportEvery:16})
    }
  }
}
function dropQueued(cacheKey){
  if(!bgQueued.has(cacheKey))return
  bgQueued.delete(cacheKey)
  bgQueue=bgQueue.filter(job=>job.key!==cacheKey)
}
export function initThreats(words){
  if(!panel||!status||!board)return
  if(!('Worker' in window)){unavailable();return}
  try{
    worker=new Worker(new URL('./threat-worker.js?v=ev-prefetch1',import.meta.url),{type:'module'})
    worker.onmessage=({data})=>{
      const jobKey=jobs.get(data.id)
      if(!jobKey)return
      if(handleWorkerResult(data,jobKey)){
        jobs.delete(data.id)
        pumpBackground()
      }
    }
    worker.onerror=event=>{
      console.error('EV worker failed',event)
      worker?.terminate();worker=null
      unavailable()
    }
    worker.postMessage({type:'init',words})
    bgWorkers=Array.from({length:BG_WORKERS},()=>makeBackgroundWorker(words))
  }catch(error){
    console.error('EV worker unavailable',error)
    unavailable()
  }
}

function touchCache(cacheKey,entry){
  if(!cacheKey)return
  if(cache.has(cacheKey))cache.delete(cacheKey)
  cache.set(cacheKey,entry)
  while(cache.size>CACHE_LIMIT){
    const oldest=cache.keys().next().value
    const old=cache.get(oldest)
    if(old?.id)jobs.delete(old.id)
    cache.delete(oldest)
  }
}
function resetTurnCache(turnKey){
  if(cacheTurn===turnKey)return
  cacheTurn=turnKey
  // A real turn change invalidates every hypothetical position. This is the
  // only time we globally cancel worker calculations.
  worker?.postMessage({type:'cancel'})
  for(const slot of bgWorkers){
    slot.worker?.postMessage({type:'cancel'})
    slot.busy=false
    slot.id=0
    slot.key=''
  }
  bgQueue=[]
  bgQueued.clear()
  cache.clear()
  jobs.clear()
  results={}
  pending={}
  resultsKey=''
  painted=null
}
function updateStatus(entry=cache.get(key)){
  const sides=entry?.sides||pending
  const failed=SIDES.some(side=>sides[side]?.error)
  const busy=!SIDES.every(side=>complete(sides[side]))
  if(failed)setStatus('error','Some EV data is unavailable')
  else if(busy)setStatus('busy',SIDES.every(side=>ready(sides[side]))?'Refining EV':'Calculating EV')
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
  const r=Math.floor(index/SIZE),c=index%SIZE
  if(context?.state?.board?.[r]?.[c]){hideTip();return}
  if(resultsKey!==key||!SIDES.some(side=>results[side]?.result?.samples)){hideTip();return}
  active={index}
  const youEv=results.you?.result?.samples?evAt(results.you.result,index):null
  const oppEv=results.opponent?.result?.samples?evAt(results.opponent.result,index):null
  tip.innerHTML=`<div class="heat-tip-square"><b>${coord(index)}</b></div>
    <strong class="heat-tip-score you">${youEv===null?'—':youEv.toFixed(1)}</strong>
    <i class="heat-tip-vs">vs</i>
    <strong class="heat-tip-score opponent">${oppEv===null?'—':oppEv.toFixed(1)}</strong>`
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
function analysisPayloads(state,selected,myId){
  const mine=state.players.find(p=>p.id===myId)
  if(!mine)return null
  const pool=unseenPool(state.board,mine.rack||[])
  const previewBoard=selected?applyMove(state.board,selected.placements):state.board
  const payloads={}
  for(const side of SIDES){
    const kept=side==='you'
      ?(selected?removeRackTiles(mine.rack||[],selected.placements):mine.rack||[])
      :[]
    const size=side==='you'
      ?(selected?Math.min(state.bagCount,7-kept.length):0)
      :state.players.find(p=>p.id!==myId)?.rackCount||0
    payloads[side]={board:previewBoard,pool,size,kept}
  }
  return payloads
}
export function prefetchThreats(state,moves,myId){
  if(!state||state.status!=='playing'||!worker||!bgWorkers.length||!moves?.length)return
  resetTurnCache(`${myId}|${state.revision}`)
  const turnKey=cacheTurn
  const top=[...moves].sort((a,b)=>b.score-a.score).slice(0,PREFETCH_LIMIT)
  for(const move of top){
    const cacheKey=analysisKey(state,move,myId)
    const moveKey=keyOfMove(move)
    const existing=cache.get(cacheKey)
    if(existing){
      if(!existing.moveKey)existing.moveKey=moveKey
      existing.revision=state.revision
      emitMoveEv(existing)
      continue
    }
    if(bgQueued.has(cacheKey))continue
    const payloads=analysisPayloads(state,move,myId)
    if(!payloads)continue
    bgQueued.add(cacheKey)
    bgQueue.push({key:cacheKey,moveKey,revision:state.revision,turnKey,payloads})
  }
  pumpBackground()
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
    jobs.clear()
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
  hideTip()
  dropQueued(key)

  // If this preview was already started, restore its latest partial heatmap
  // immediately. Its worker job has continued running while it was off-screen.
  const cached=cache.get(key)
  if(cached){
    touchCache(key,cached)
    pending=cached.sides
    if(SIDES.every(side=>ready(pending[side]))){
      results={...pending}
      resultsKey=key
      painted=null
      paint()
      renderBoardEv()
    }else{
      ensureHeatShell()
      panel.classList.add('ev-stale')
    }
    updateStatus(cached)
    return
  }

  // Brand-new preview: preserve the currently painted map until both sides
  // have their first partial result, then swap to the new map atomically.
  ensureHeatShell()
  panel.classList.add('ev-stale')
  setStatus('busy','Calculating EV')

  const mine=state.players.find(p=>p.id===myId)
  if(selected&&state.bagCount===0&&selected.placements.length===mine?.rack.length){
    setStatus('ready','Game ending')
    return
  }

  const id=++request
  const entry={id,sides:{},done:false,updated:performance.now(),moveKey:selected?keyOfMove(selected):'',revision:state.revision}
  touchCache(key,entry)
  jobs.set(id,key)

  if(!worker){unavailable();return}
  const payloads=analysisPayloads(state,selected,myId)
  if(!payloads){unavailable();return}
  for(const side of SIDES)worker.postMessage({id,side,...payloads[side],reportEvery:8})
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
