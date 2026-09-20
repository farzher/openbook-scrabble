import {DISTRIBUTION,SIZE,applyMove,removeRackTiles} from './game.js'

const panel=document.querySelector('#threatPanel')
const status=document.querySelector('#threatStatus')
const phase=document.querySelector('#threatPhase')
const summary=document.querySelector('#threatSummary')
const board=document.querySelector('#board')

const tip=document.createElement('div')
tip.id='heatTooltip'
tip.className='heat-tooltip'
tip.hidden=true
tip.setAttribute('role','tooltip')
document.body.append(tip)

let worker=null,request=0,key='',timer=null,context=null,results={},mode='both',active=null,pinned=false

const sides=()=>mode==='both'?['you','opponent']:mode==='off'?[]:[mode]
const coord=i=>`${String.fromCharCode(65+i%SIZE)}${Math.floor(i/SIZE)+1}`
const chance=(hits,result)=>result?.samples?hits/result.samples:0
const percent=(hits,result,exact)=>`${exact?'':'≈'}${Math.round(chance(hits,result)*100)}%`
const scoreStrength=score=>Math.max(0,Math.min(1,score/70))
const sideLabel=side=>{
  if(side==='you')return'You'
  const opponent=context?.state?.players.find(p=>p.id!==context.myId)
  return opponent?.name||'Opponent'
}
const sidePhase=side=>{
  if(side==='you')return context?.preview?'After refill':'Current rack'
  return context?.preview?'Reply to preview':'Possible reply'
}

function unavailable(){
  status.textContent='Unavailable'
  status.dataset.state='error'
  panel.removeAttribute('aria-busy')
  renderSummary()
}
export function initThreats(words){
  if(!('Worker' in window)){unavailable();return}
  try{
    worker=new Worker(new URL('./threat-worker.js',import.meta.url),{type:'module'})
    worker.onmessage=({data})=>{
      if(data.id!==request)return
      results[data.side]=data
      updateStatus()
      paint()
      renderSummary()
    }
    worker.onerror=()=>{worker?.terminate();worker=null;unavailable()}
    worker.postMessage({type:'init',words})
  }catch{unavailable()}
}

function updateStatus(){
  const visible=sides()
  if(!visible.length){
    status.textContent='Hidden'
    status.dataset.state='hidden'
    panel.removeAttribute('aria-busy')
    return
  }
  const busy=visible.some(side=>!results[side]?.done&&!results[side]?.error)
  const failed=visible.some(side=>results[side]?.error)
  const allExact=visible.length&&visible.every(side=>results[side]?.exact)
  status.textContent=busy?'Sampling':failed?'Partial':allExact?'Exact':'Estimated'
  status.dataset.state=busy?'busy':failed?'error':allExact?'exact':'estimate'
  status.setAttribute('aria-label',busy?'Sampling possible racks':failed?'Some forecast data is unavailable':allExact?'Exact forecast':'Estimated from sampled racks')
  panel.setAttribute('aria-busy',String(busy))
}

function bestHotspot(side){
  const data=results[side]
  const result=data?.result
  if(!result?.samples)return null
  let index=-1,impact=-1
  for(let i=0;i<result.hits.length;i++){
    const hits=result.hits[i]
    if(!hits)continue
    const avg=result.scores[i]/hits
    // Balance frequency and scoring power so the summary represents the
    // most strategically meaningful square rather than only the most common one.
    const value=chance(hits,result)*avg
    if(value>impact){impact=value;index=i}
  }
  if(index<0)return null
  const hits=result.hits[index]
  return {
    index,
    chance:chance(hits,result),
    score:result.scores[index]/hits,
    example:result.examples[index],
    exact:!!data.exact,
    samples:result.samples
  }
}

function renderSummary(){
  if(mode==='off'){
    summary.innerHTML='<div class="forecast-muted">Forecast hidden</div>'
    return
  }
  summary.innerHTML=sides().map(side=>{
    const data=results[side]
    if(data?.error)return`<div class="forecast-hotspot unavailable" data-side="${side}"><span class="forecast-side"><i></i>${sideLabel(side)}</span><b>Unavailable</b></div>`
    const hot=bestHotspot(side)
    if(!hot)return`<div class="forecast-hotspot loading" data-side="${side}"><span class="forecast-side"><i></i>${sideLabel(side)}</span><b>${data?.done?'No lane':'Sampling…'}</b><span>${sidePhase(side)}</span></div>`
    return`<button class="forecast-hotspot" data-side="${side}" data-hotspot-index="${hot.index}" title="Show this hotspot on the board">
      <span class="forecast-side"><i></i>${sideLabel(side)}</span>
      <strong>${coord(hot.index)}</strong>
      <span class="forecast-numbers"><b>${hot.exact?'': '≈'}${Math.round(hot.chance*100)}%</b><em>·</em><b>${Math.round(hot.score)} pts</b></span>
      <small>${sidePhase(side)}</small>
    </button>`
  }).join('')
}

function hideTip(){
  active=null
  pinned=false
  tip.hidden=true
  board.querySelectorAll('.opponent-ghost').forEach(el=>el.remove())
  board.querySelectorAll('.forecast-focus').forEach(el=>el.classList.remove('forecast-focus'))
  board.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))
}
function positionTip(){
  if(active===null||tip.hidden)return
  const target=board.children[active.index]
  if(!target)return
  const rect=target.getBoundingClientRect(),width=tip.offsetWidth,height=tip.offsetHeight
  tip.style.left=`${Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2))}px`
  const top=rect.top-height-12
  tip.style.top=`${Math.max(8,Math.min(innerHeight-height-8,top>=8?top:rect.bottom+12))}px`
}
function showTip(index,side){
  const {result,exact}=results[side]||{}
  if(!result?.hits[index])return
  active={index,side}
  tip.dataset.side=side
  const avg=Math.round(result.scores[index]/result.hits[index])
  const move=result.examples[index]
  const label=sideLabel(side)
  tip.innerHTML=`<header>
      <div class="heat-eyebrow"><i></i><span>${label}</span><small>${sidePhase(side)}</small></div>
      <div class="heat-title"><b>${coord(index)}</b><span>future lane</span></div>
    </header>
    <div class="heat-metrics">
      <div><strong>${percent(result.hits[index],result,exact)}</strong><span>Likelihood</span></div>
      <div><strong>${avg}<small> pts</small></strong><span>Avg when used</span></div>
    </div>
    <div class="heat-example"><span>Example</span><b>${move.word}</b><strong>${move.score}</strong></div>
    <footer>${exact?'Exact from known rack':`${result.samples} sampled racks · estimate`}</footer>`
  tip.hidden=false

  board.querySelectorAll('.opponent-ghost').forEach(el=>el.remove())
  board.querySelectorAll('.forecast-focus').forEach(el=>el.classList.remove('forecast-focus'))
  board.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))
  const cell=board.children[index]
  cell?.classList.add('forecast-focus')
  cell?.querySelector(`[data-side="${side}"].heat-hit`)?.setAttribute('aria-describedby',tip.id)

  for(const p of move.placements){
    const tile=document.createElement('span')
    tile.className='opponent-ghost'
    tile.dataset.side=side
    tile.textContent=p.letter+(p.blank?'·':'')
    board.children[p.r*SIZE+p.c]?.append(tile)
  }
  positionTip()
}
function clearPaint(){
  hideTip()
  board.querySelectorAll('.heat-hit').forEach(el=>el.remove())
  for(const cell of board.children){
    if(cell.dataset.heatTitle!==undefined){
      cell.title=cell.dataset.heatTitle
      delete cell.dataset.heatTitle
    }
  }
}
function paint(){
  board.classList.toggle('heat-both',mode==='both')
  board.classList.toggle('forecast-on',mode!=='off')
  for(const side of sides()){
    const {result,exact}=results[side]||{}
    if(!result)continue
    for(let i=0;i<result.hits.length;i++){
      const cell=board.children[i]
      if(!cell)continue
      if(cell.hasAttribute('title')){cell.dataset.heatTitle=cell.title;cell.removeAttribute('title')}
      if(!result.hits[i])continue
      let button=cell.querySelector(`[data-side="${side}"].heat-hit`)
      if(!button){
        button=document.createElement('button')
        button.className='heat-hit'
        button.dataset.side=side
        button.innerHTML='<i aria-hidden="true"></i>'
        button.onpointerenter=e=>{if(e.pointerType!=='touch'&&!pinned)showTip(i,side)}
        button.onpointerleave=()=>{if(!pinned)hideTip()}
        button.onfocus=()=>{if(!pinned)showTip(i,side)}
        button.onblur=()=>{if(!pinned)hideTip()}
        button.onclick=()=>{
          if(pinned&&active?.index===i&&active?.side===side)hideTip()
          else{pinned=true;showTip(i,side)}
        }
        cell.append(button)
      }
      const probability=chance(result.hits[i],result)
      const avg=result.scores[i]/result.hits[i]
      button.style.setProperty('--probability',probability.toFixed(3))
      button.style.setProperty('--diameter',`${18+66*Math.sqrt(probability)}%`)
      button.style.setProperty('--strength',scoreStrength(avg).toFixed(3))
      button.setAttribute('aria-label',`${sideLabel(side)}, ${coord(i)}: ${percent(result.hits[i],result,exact)} likelihood; ${Math.round(avg)} point average when used`)
    }
  }
  if(active!==null)showTip(active.index,active.side)
}

export function updateThreats(state,selected,myId){
  context=state?{state,preview:selected,myId}:null
  panel.classList.toggle('hidden',!state||state.status!=='playing')
  if(phase)phase.textContent=selected?'After preview':'Current board'

  const mine=state?.players.find(p=>p.id===myId)
  const next=state&&state.status==='playing'&&mode!=='off'
    ?JSON.stringify([mode,myId,state.revision,state.board,mine?.rack,selected?.placements])
    :''
  if(next===key){
    paint()
    renderSummary()
    updateStatus()
    return
  }

  key=next
  request++
  clearTimeout(timer)
  worker?.postMessage({type:'cancel'})
  results={}
  clearPaint()
  panel.removeAttribute('aria-busy')

  if(!next){
    updateStatus()
    renderSummary()
    return
  }
  if(selected&&state.bagCount===0&&selected.placements.length===mine?.rack.length){
    status.textContent='Game ending'
    status.dataset.state='exact'
    renderSummary()
    return
  }

  status.textContent='Sampling'
  status.dataset.state='busy'
  panel.setAttribute('aria-busy','true')
  renderSummary()

  const counts={...DISTRIBUTION}
  for(const row of state.board)for(const tile of row)if(tile)counts[tile.blank?'?':tile.letter]--
  for(const tile of mine?.rack||[])counts[tile]--
  const pool=Object.entries(counts).flatMap(([letter,n])=>Array(Math.max(0,n)).fill(letter))
  const id=request

  timer=setTimeout(()=>{
    if(!worker){unavailable();return}
    for(const side of sides()){
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
  },120)
}

panel.onclick=e=>{
  const modeButton=e.target.closest('[data-heat-mode]')
  if(modeButton){
    mode=modeButton.dataset.heatMode
    panel.querySelectorAll('[data-heat-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el===modeButton)))
    if(context)updateThreats(context.state,context.preview,context.myId)
    return
  }
  const hotspot=e.target.closest('[data-hotspot-index]')
  if(hotspot){
    const side=hotspot.dataset.side,index=Number(hotspot.dataset.hotspotIndex)
    if(pinned&&active?.index===index&&active?.side===side)hideTip()
    else{pinned=true;showTip(index,side)}
  }
}

document.addEventListener('pointerdown',e=>{
  if(!e.target.closest('.heat-hit,.forecast-hotspot,.heat-tooltip'))hideTip()
})
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip()})
window.addEventListener('resize',positionTip)
window.addEventListener('scroll',positionTip,true)
