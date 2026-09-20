import {SIZE,applyMove,removeRackTiles} from './game.js'
import {unseenPool} from './threats.js'
import {dualCloudPixels} from './heatmap.js'

const panel=document.querySelector('#threatPanel')
const status=document.querySelector('#threatStatus')
const phase=document.querySelector('#threatPhase')
const board=document.querySelector('#board')

const tip=document.createElement('div')
tip.id='heatTooltip'
tip.className='heat-tooltip'
tip.hidden=true
tip.setAttribute('role','tooltip')
panel.append(tip)

let worker=null,request=0,key='',timer=null,context=null,results={},active=null
const SIDES=['you','opponent']
let enabled=true,painted=null
const canvas=document.createElement('canvas')
canvas.width=canvas.height=240
const brush=canvas.getContext('2d')
const toggle=panel.querySelector('#heatToggle')
toggle.addEventListener('click',()=>{
  enabled=!enabled
  toggle.setAttribute('aria-pressed',String(enabled))
  toggle.textContent=enabled?'Heatmap on':'Heatmap off'
  hideTip();paint()
})
const coord=i=>`${String.fromCharCode(65+i%SIZE)}${Math.floor(i/SIZE)+1}`
const evAt=(result,index)=>result?.samples?(result.scores?.[index]||0)/result.samples:0
// EV = average best score placing a tile here, including zero for racks
// without a legal play here. It is not win probability or multi-turn equity.
// Independent blue/red channels on the same fixed EV scale.
const sidePhase=side=>{
  if(side==='you')return context?.preview?'After refill':'Current rack'
  return context?.preview?'Reply to preview':'Possible rack'
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
    worker=new Worker(new URL('./threat-worker.js?v=ev4',import.meta.url),{type:'module'})
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
  tip.hidden=true
  board.querySelectorAll('.opponent-ghost').forEach(el=>el.remove())
  board.querySelectorAll('.forecast-focus').forEach(el=>el.classList.remove('forecast-focus'))
  board.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))
}
function showTip(index){
  if(!SIDES.some(side=>results[side]?.result?.samples)){hideTip();return}
  active={index}
  tip.innerHTML=`<div class="heat-tip-head"><b>${coord(index)}</b><small>Expected pts</small></div>`+SIDES.map(side=>{
    const data=results[side],result=data?.result
    const ready=!!result?.samples
    const note=ready?(data.exact?'exact':`${result.samples} racks`):(data?.error?'unavailable':'sampling…')
    return `<div class="dual-ev" data-side="${side}">
      <span>${side==='you'?'You':'Opponent'} <small>${note}</small></span>
      <strong>${ready?evAt(result,index).toFixed(1):'—'}</strong>
      <small class="dual-phase">${sidePhase(side)}</small>
    </div>`
  }).join('')

  tip.hidden=false
  board.querySelectorAll('.opponent-ghost').forEach(el=>el.remove())
  board.querySelectorAll('.forecast-focus').forEach(el=>el.classList.remove('forecast-focus'))
  board.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'))

  const cell=board.children[index]
  cell?.classList.add('forecast-focus')
  cell?.setAttribute('aria-describedby',tip.id)

  // Keep forecast examples off the board: they are not necessarily playable
  // with your rack, and must never obscure the actual move preview.
}

function clearPaint(){
  hideTip()
  painted=null
  board.classList.remove('heat-cloud')
  board.style.removeProperty('background-image')
  for(const cell of board.children){
    if(cell.dataset.heatTitle!==undefined){
      cell.title=cell.dataset.heatTitle
      delete cell.dataset.heatTitle
    }
  }
}

function paint(){
  if(!board)return
  const pair=SIDES.map(side=>results[side]?.result)
  if(!enabled||!pair.some(result=>result?.samples)||!brush){clearPaint();return}
  board.classList.add('heat-cloud')
  if(!painted||pair.some((result,i)=>result!==painted[i])){
    const values=pair.map(result=>result?.samples?result.scores.map(score=>score/result.samples):Array(SIZE*SIZE).fill(0))
    const image=brush.createImageData(240,240)
    image.data.set(dualCloudPixels(...values))
    brush.putImageData(image,0,0)
    board.style.backgroundImage=`url("${canvas.toDataURL()}")`
    painted=pair
  }
  for(const cell of board.children){
    if(cell.hasAttribute('title')){cell.dataset.heatTitle=cell.title;cell.removeAttribute('title')}
  }
  if(active!==null)showTip(active.index)
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

  // Use the pre-preview board AND full rack: played tiles must not become
  // available to either the opponent or our hypothetical refill.
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
  },100)
}

board.addEventListener('pointermove',e=>{
  const cell=e.target.closest('.cell')
  if(!cell)return
  const index=Number(cell.dataset.r)*SIZE+Number(cell.dataset.c)
  if(enabled)showTip(index)
  else hideTip()
})
board.addEventListener('pointerleave',hideTip)
board.addEventListener('focusin',e=>{
  const cell=e.target.closest('.cell')
  if(cell&&enabled)showTip(Number(cell.dataset.r)*SIZE+Number(cell.dataset.c))
})
board.addEventListener('focusout',hideTip)
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#board'))hideTip()})
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip()})
