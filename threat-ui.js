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
let bgWorkers=[],surveyQueue=[],refineQueue=[],priorityQueue=[],bgQueued=new Set(),bgDispatch=0
const SIDES=['you','opponent']
const MAX_SAMPLES=96
const CACHE_LIMIT=512
const SAMPLE_STAGES=[1,4,16,48,96]
const CORES=navigator.hardwareConcurrency||4
const PRIORITY_ROWS=10
// Workers do not execute on the UI thread. Reserve two logical cores for the
// browser/OS and use the rest, up to eight, for continuous EV refinement.
const BG_WORKERS=CORES<=4?1:CORES<=8?2:CORES<=12?3:4
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
function sampleDepth(sides){
  if(!sides)return 0
  let depth=MAX_SAMPLES
  for(const side of SIDES){
    const data=sides[side]
    if(!data?.result?.samples)return 0
    depth=Math.min(depth,data.exact?MAX_SAMPLES:data.result.samples)
  }
  return depth
}
function fullyRefined(entry){
  return SIDES.every(side=>{
    const data=entry?.sides?.[side]
    return !!(data?.error||data?.exact||data?.result?.samples>=MAX_SAMPLES)
  })
}
function emitMoveEv(moveKey,revision,sides){
  if(!moveKey||!SIDES.every(side=>sides?.[side]?.result?.samples))return
  const you=boardEv(sides.you.result),opponent=boardEv(sides.opponent.result)
  if(you===null||opponent===null)return
  const samples=sampleDepth(sides)
  document.dispatchEvent(new CustomEvent('openbook-move-ev',{detail:{
    revision,moveKey,you,opponent,diff:you-opponent,samples,done:samples>=MAX_SAMPLES
  }}))
}
function foregroundBusy(cacheKey){
  for(const jobKey of jobs.values())if(jobKey===cacheKey)return true
  return false
}
function handleForegroundResult(data,jobKey){
  if(!jobKey)return false
  const entry=cache.get(jobKey)
  if(!entry||entry.id!==data.id)return false

  entry.sides[data.side]=data
  entry.updated=performance.now()
  touchCache(jobKey,entry)
  emitMoveEv(entry.moveKey,entry.revision,entry.sides)

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
function nextSampleTarget(depth){
  return SAMPLE_STAGES.find(samples=>samples>depth)||0
}
function queueBackground(base,samples){
  if(!samples||base.turnKey!==cacheTurn||foregroundBusy(base.key))return
  const token=`${base.key}@${samples}`
  if(bgQueued.has(token))return
  const job={...base,samples,token}
  bgQueued.add(token)
  const stage=SAMPLE_STAGES.indexOf(samples)

  // The first screenful gets deeper estimates early, but the survey queue
  // still advances so every rendered row receives an automatic estimate.
  if(base.rank<PRIORITY_ROWS&&samples>1){
    job.priority=base.rank+stage*PRIORITY_ROWS
    priorityQueue.push(job)
    priorityQueue.sort((a,b)=>a.priority-b.priority||a.rank-b.rank)
  }else if(samples===1){
    surveyQueue.push(job)
  }else{
    job.priority=base.rank+stage*10
    refineQueue.push(job)
    refineQueue.sort((a,b)=>a.priority-b.priority||a.rank-b.rank)
  }
}
function queueNextBackground(job,depth){
  const samples=nextSampleTarget(depth)
  if(!samples)return
  queueBackground({
    key:job.key,moveKey:job.moveKey,revision:job.revision,turnKey:job.turnKey,
    state:job.state,move:job.move,myId:job.myId,rank:job.rank
  },samples)
}
function finishBackground(slot){
  if(slot.job?.token)bgQueued.delete(slot.job.token)
  slot.busy=false
  slot.id=0
  slot.key=''
  slot.job=null
  slot.sides={}
  pumpBackground()
}
function handleBackgroundResult(slot,data){
  if(!slot.busy||data.id!==slot.id)return
  slot.sides[data.side]=data
  if(!SIDES.every(side=>complete(slot.sides)))return

  const depth=sampleDepth(slot.sides)
  const current=cache.get(slot.key)
  const currentDepth=sampleDepth(current?.sides)
  if(!foregroundBusy(slot.key)&&depth>=currentDepth){
    const entry={
      id:slot.id,sides:{...slot.sides},done:depth>=MAX_SAMPLES,updated:performance.now(),
      moveKey:slot.job.moveKey,revision:slot.job.revision,background:true,targetSamples:slot.job.samples
    }
    touchCache(slot.key,entry)
    emitMoveEv(entry.moveKey,entry.revision,entry.sides)
    queueNextBackground(slot.job,depth)
  }
  finishBackground(slot)
}
function makeBackgroundWorker(words){
  const slot={worker:null,ready:false,busy:false,id:0,key:'',job:null,sides:{}}
  try{
    slot.worker=new Worker(new URL('./threat-worker.js?v=ev-bgfix2',import.meta.url),{type:'module'})
    slot.worker.onmessage=({data})=>{
      if(data.type==='ready'){
        slot.ready=true
        pumpBackground()
        return
      }
      handleBackgroundResult(slot,data)
    }
    slot.worker.onerror=event=>{
      console.error('Background EV worker failed',event)
      slot.worker?.terminate()
      slot.worker=null
      if(slot.job?.token)bgQueued.delete(slot.job.token)
      slot.busy=false
      slot.job=null
      slot.sides={}
    }
    slot.worker.postMessage({type:'init',words})
  }catch(error){
    console.error('Background EV worker unavailable',error)
  }
  return slot
}
function takeBackgroundJob(){
  while(surveyQueue.length||priorityQueue.length||refineQueue.length){
    let job
    // Before every row has a rough value, alternate three breadth jobs with
    // one top-row refinement. After that, refinement runs continuously.
    if(surveyQueue.length&&bgDispatch++%4!==3)job=surveyQueue.shift()
    else job=priorityQueue.shift()||refineQueue.shift()||surveyQueue.shift()

    if(!job)continue
    if(job.turnKey!==cacheTurn){bgQueued.delete(job.token);continue}
    const current=cache.get(job.key)
    if(foregroundBusy(job.key)||sampleDepth(current?.sides)>=job.samples){
      bgQueued.delete(job.token)
      continue
    }
    return job
  }
  return null
}
function pumpBackground(){
  for(const slot of bgWorkers){
    if(slot.busy||!slot.worker||!slot.ready)continue
    const job=takeBackgroundJob()
    if(!job)continue

    const payloads=analysisPayloads(job.state,job.move,job.myId)
    if(!payloads){
      bgQueued.delete(job.token)
      continue
    }

    const current=cache.get(job.key)
    const id=++request
    document.dispatchEvent(new CustomEvent('openbook-move-ev-work',{detail:{
      revision:job.revision,moveKey:job.moveKey,samples:sampleDepth(current?.sides),target:job.samples
    }}))
    slot.busy=true
    slot.id=id
    slot.key=job.key
    slot.job=job
    slot.sides={}

    for(const side of SIDES){
      const initialResult=current?.sides?.[side]?.result||null
      const start=initialResult?.samples||0
      slot.worker.postMessage({
        id,side,...payloads[side],
        samples:job.samples,
        initialResult,
        reportEvery:Math.max(1,job.samples-start)
      })
    }
  }
}
function dropQueued(cacheKey){
  surveyQueue=surveyQueue.filter(job=>{
    if(job.key!==cacheKey)return true
    bgQueued.delete(job.token)
    return false
  })
  priorityQueue=priorityQueue.filter(job=>{
    if(job.key!==cacheKey)return true
    bgQueued.delete(job.token)
    return false
  })
  refineQueue=refineQueue.filter(job=>{
    if(job.key!==cacheKey)return true
    bgQueued.delete(job.token)
    return false
  })
  for(const slot of bgWorkers){
    if(!slot.busy||slot.key!==cacheKey)continue
    slot.worker?.postMessage({type:'cancel'})
    if(slot.job?.token)bgQueued.delete(slot.job.token)
    slot.busy=false
    slot.id=0
    slot.key=''
    slot.job=null
    slot.sides={}
  }
  pumpBackground()
}
export function initThreats(words){
  if(!panel||!status||!board)return
  if(!('Worker' in window)){unavailable();return}
  try{
    worker=new Worker(new URL('./threat-worker.js?v=ev-bgfix2',import.meta.url),{type:'module'})
    worker.onmessage=({data})=>{
      if(data.type==='ready')return
      const jobKey=jobs.get(data.id)
      if(!jobKey)return
      if(handleForegroundResult(data,jobKey)){
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
    slot.job=null
    slot.sides={}
  }
  surveyQueue=[]
  priorityQueue=[]
  refineQueue=[]
  bgQueued.clear()
  bgDispatch=0
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
  const ranked=[...moves].sort((a,b)=>b.score-a.score)

  ranked.forEach((move,rank)=>{
    const cacheKey=analysisKey(state,move,myId)
    const moveKey=keyOfMove(move)
    const existing=cache.get(cacheKey)
    if(existing){
      if(!existing.moveKey)existing.moveKey=moveKey
      existing.revision=state.revision
      emitMoveEv(existing.moveKey,existing.revision,existing.sides)
    }
    const depth=sampleDepth(existing?.sides)
    const samples=nextSampleTarget(depth)
    if(samples)queueBackground({
      key:cacheKey,moveKey,revision:state.revision,turnKey,
      state,move,myId,rank
    },samples)
  })
  pumpBackground()
}

function startForegroundAnalysis(state,selected,myId){
  if(!worker||foregroundBusy(key))return
  const payloads=analysisPayloads(state,selected,myId)
  if(!payloads){unavailable();return}

  const cached=cache.get(key)
  const seedSides=cached?.sides||{}
  const id=++request
  const entry={
    id,sides:{...seedSides},done:false,updated:performance.now(),
    moveKey:selected?keyOfMove(selected):'',revision:state.revision,foreground:true
  }
  touchCache(key,entry)
  jobs.set(id,key)
  pending=entry.sides
  setStatus('busy','Refining EV')
  for(const side of SIDES)worker.postMessage({
    id,side,...payloads[side],
    samples:MAX_SAMPLES,
    initialResult:seedSides[side]?.result||null,
    reportEvery:8
  })
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

  const mine=state.players.find(p=>p.id===myId)
  if(selected&&state.bagCount===0&&selected.placements.length===mine?.rack.length){
    setStatus('ready','Game ending')
    return
  }

  // A prefetched move appears instantly from its rough cached result, then
  // the dedicated foreground worker takes it all the way to full precision.
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
    if(fullyRefined(cached)){
      updateStatus(cached)
      return
    }
    updateStatus(cached)
    startForegroundAnalysis(state,selected,myId)
    return
  }

  // Brand-new preview: preserve the previous map until the first foreground
  // partial arrives, then refine in-place.
  ensureHeatShell()
  panel.classList.add('ev-stale')
  setStatus('busy','Calculating EV')
  startForegroundAnalysis(state,selected,myId)
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
