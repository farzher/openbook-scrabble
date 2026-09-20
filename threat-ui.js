import {DISTRIBUTION,SIZE,applyMove,removeRackTiles} from './game.js'

const panel=document.querySelector('#threatPanel')
const status=document.querySelector('#threatStatus')
const phase=document.querySelector('#threatPhase')
const board=document.querySelector('#board')

const tip=document.createElement('div')
tip.id='heatTooltip'
tip.className='heat-tooltip'
tip.hidden=true
tip.setAttribute('role','tooltip')
document.body.append(tip)

let worker=null,request=0,key='',timer=null,context=null,results={},active=null,pinned=false
const SIDES=['you','opponent']
const coord=i=>`${String.fromCharCode(65+i%SIZE)}${Math.floor(i/SIZE)+1}`
const evAt=(result,index)=>result?.samples?(result.scores?.[index]||0)/result.samples:0
const playChance=(result,index)=>result?.samples?(result.hits?.[index]||0)/result.samples:0
const bestScore=(result,index)=>result?.topScores?.[index]||result?.examples?.[index]?.score||0

// EV is intentionally the one visual metric. 0 -> cool green, ~20 -> yellow,
// 40+ -> warm red. Clamp beyond 50 so extreme outliers don't flatten the scale.
const evHue=ev=>Math.max(0,Math.min(120,120-(Math.min(ev,50)/50)*120))
const evAlpha=ev=>Math.max(.18,Math.min(.95,.24+Math.sqrt(Math.min(ev,50)/50)*.71))

const sideLabel=side=>{
  if(side==='you')return'You'
  const opponent=context?.state?.players.find(p=>p.id!==context.myId)
  return opponent?.name||'Opponent'
}
const sidePhase=side=>{
  if(side==='you')return context?.preview?'After refill':'Current rack'
  return context?.preview?'Reply to preview':'Possible reply'
}

function unavailable(message='Unavailable'){
  status.textContent=message
  status.dataset.state='error'
  panel.removeAttribute('aria-busy')
}

export function initThreats(words){
  if(!panel||!status||!phase||!board)return
  if(!('Worker' in window)){unavailable();return}
  try{
    worker=new Worker(new URL('./threat-worker.js?v=ev3',import.meta.url),{type:'module'})
    worker.onmessage=({data})=>{
      if(data.id!==request)return
      results[data.side]=data
      updateStatus()
      paint()
    }
    worker.onerror=event=>{
      console.error('Future-value worker failed',event)
      worker?.terminate();worker=null
      unavailable()
    }
    worker.postMessage({type:'init',words})
  }catch(error){
    console.error('Future-value worker unavailable',error)
    unavailable()
  }
}

function updateStatus(){
  if(!panel||!status)return
  const busy=SIDES.some(side=>!results[side]?.done&&!results[side]?.error)
  const failed=SIDES.some(side=>results[side]?.error)
  const exact=SIDES.every(side=>results[side]?.exact)
  const hasData=SIDES.some(side=>results[side]?.result?.samples)
  status.textContent=failed?'Partial':busy?(hasData?'Refining…':'Sampling…'):exact?'Exact':'Estimated'
  status.dataset.state=failed?'error':busy?'busy':exact?'exact':'estimate'
  panel.setAttribute('aria-busy',String(busy))
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
  const data=results[side]
  const result=data?.result
  const ev=evAt(result,index)
  if(!result||ev<=0)return

  const chance=playChance(result,index)
  const best=bestScore(result,index)
  const move=result.examples?.[index]

  active={index,side}
  tip.dataset.side=side
  tip.style.setProperty('--ev-hue',evHue(ev))

  tip.innerHTML=`<div class="heat-tip-head">
      <span class="heat-side-shape ${side}"></span>
      <b>${sideLabel(side)}</b>
      <small>${sidePhase(side)} · ${coord(index)}</small>
    </div>
    <div class="ev-primary">
      <span>Expected value</span>
      <strong>${ev.toFixed(1)}<small> pts</small></strong>
    </div>
    <div class="ev-details">
      <span>Playable <b>${data.exact?'': '≈'}${Math.round(chance*100)}%</b></span>
      <span>Best sampled <b>${best || '—'}</b></span>
    </div>
    ${move?`<div class="heat-example"><span>Example</span><b>${move.word}</b><strong>${move.score}</strong></div>`:''}
    <footer>${data.exact?'Exact from known tiles':`${result.samples} sampled racks · EV includes zero when unusable`}</footer>`

  tip.hidden=false
  board.querySelectorAll('.opponent-ghost').forEach(el=>el.remove())
  board.querySelectorAll('.forecast-focus').forEach(el=>el.classList.remove('forecast-focus'))
  board.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))

  const cell=board.children[index]
  cell?.classList.add('forecast-focus')
  cell?.querySelector(`[data-side="${side}"].heat-hit`)?.setAttribute('aria-describedby',tip.id)

  if(move){
    for(const p of move.placements){
      const tile=document.createElement('span')
      tile.className='opponent-ghost'
      tile.dataset.side=side
      tile.style.setProperty('--ev-hue',evHue(ev))
      tile.textContent=p.letter+(p.blank?'·':'')
      board.children[p.r*SIZE+p.c]?.append(tile)
    }
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
  if(!board)return
  board.classList.add('heat-both')
  for(const side of SIDES){
    const data=results[side]
    const result=data?.result
    if(!result?.samples)continue

    for(let i=0;i<SIZE*SIZE;i++){
      const ev=evAt(result,i)
      const cell=board.children[i]
      if(!cell)continue

      let button=cell.querySelector(`[data-side="${side}"].heat-hit`)
      if(ev<=.05){
        button?.remove()
        continue
      }
      if(cell.hasAttribute('title')){cell.dataset.heatTitle=cell.title;cell.removeAttribute('title')}

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

      button.style.setProperty('--ev-hue',evHue(ev))
      button.style.setProperty('--ev-alpha',evAlpha(ev).toFixed(3))
      button.setAttribute('aria-label',`${sideLabel(side)}, ${coord(i)}: ${ev.toFixed(1)} expected points`)
    }
  }
  if(active!==null)showTip(active.index,active.side)
}

export function updateThreats(state,selected,myId){
  if(!panel||!status||!phase||!board)return
  context=state?{state,preview:selected,myId}:null
  panel.classList.toggle('hidden',!state||state.status!=='playing')
  phase.textContent=selected?'After preview':'Current board'

  const mine=state?.players.find(p=>p.id===myId)
  const next=state&&state.status==='playing'
    ?JSON.stringify([myId,state.revision,state.board,mine?.rack,selected?.placements])
    :''
  if(next===key){
    paint()
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
    status.textContent=''
    return
  }
  if(selected&&state.bagCount===0&&selected.placements.length===mine?.rack.length){
    status.textContent='Game ending'
    status.dataset.state='exact'
    return
  }

  status.textContent='Sampling…'
  status.dataset.state='busy'
  panel.setAttribute('aria-busy','true')

  const counts={...DISTRIBUTION}
  for(const row of state.board)for(const tile of row)if(tile)counts[tile.blank?'?':tile.letter]--
  for(const tile of mine?.rack||[])counts[tile]--
  const pool=Object.entries(counts).flatMap(([letter,n])=>Array(Math.max(0,n)).fill(letter))
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
  },100)
}

document.addEventListener('pointerdown',e=>{if(!e.target.closest('.heat-hit,.heat-tooltip'))hideTip()})
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip()})
window.addEventListener('resize',positionTip)
window.addEventListener('scroll',positionTip,true)
