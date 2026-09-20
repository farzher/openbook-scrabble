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
const scoreHue=score=>Math.max(0,Math.min(120,120-score*1.2))
const topChance=(result,index)=>result?.samples?((result.topHits?.[index]||0)/result.samples):0
const topScore=(result,index)=>result?.topScores?.[index]||result?.examples?.[index]?.score||0
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
    }
    worker.onerror=()=>{worker?.terminate();worker=null;unavailable()}
    worker.postMessage({type:'init',words})
  }catch{unavailable()}
}

function updateStatus(){
  const busy=SIDES.some(side=>!results[side]?.done&&!results[side]?.error)
  const failed=SIDES.some(side=>results[side]?.error)
  const exact=SIDES.every(side=>results[side]?.exact)
  status.textContent=busy?'Sampling…':failed?'Partial':exact?'Exact':'Estimated'
  status.dataset.state=busy?'busy':failed?'error':exact?'exact':'estimate'
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
  const move=result?.examples?.[index]
  const score=topScore(result,index)
  if(!result||!move||!score)return

  const probability=topChance(result,index)
  active={index,side}
  tip.dataset.side=side
  tip.style.setProperty('--score-hue',scoreHue(score))

  tip.innerHTML=`<div class="heat-tip-head">
      <span class="heat-side-shape ${side}"></span>
      <b>${sideLabel(side)}</b>
      <small>${sidePhase(side)} · ${coord(index)}</small>
    </div>
    <div class="heat-main">
      <div><span>Top score</span><strong>${score}<small> pts</small></strong></div>
      <div><span>Chance</span><strong>${data.exact?'': '≈'}${Math.round(probability*100)}%</strong></div>
    </div>
    <div class="heat-example"><span>Example</span><b>${move.word}</b><strong>${move.score}</strong></div>
    <footer>${data.exact?'Exact from known tiles':`${result.samples} sampled racks`}</footer>`

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
    tile.style.setProperty('--score-hue',scoreHue(score))
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
  board.classList.add('heat-both')
  for(const side of SIDES){
    const data=results[side]
    const result=data?.result
    if(!result)continue

    for(let i=0;i<SIZE*SIZE;i++){
      const score=topScore(result,i)
      if(!score)continue
      const cell=board.children[i]
      if(!cell)continue
      if(cell.hasAttribute('title')){cell.dataset.heatTitle=cell.title;cell.removeAttribute('title')}

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

      const probability=topChance(result,i)
      const hue=scoreHue(score)
      button.style.setProperty('--diameter',`${18+72*Math.sqrt(probability)}%`)
      button.style.setProperty('--heat-hue',hue)
      button.style.setProperty('--marker-opacity',(0.52+0.46*Math.sqrt(probability)).toFixed(3))
      button.setAttribute('aria-label',`${sideLabel(side)}, ${coord(i)}: top score ${score}; ${data.exact?'': 'approximately '}${Math.round(probability*100)} percent chance`)
    }
  }
  if(active!==null)showTip(active.index,active.side)
}

export function updateThreats(state,selected,myId){
  context=state?{state,preview:selected,myId}:null
  panel.classList.toggle('hidden',!state||state.status!=='playing')
  if(phase)phase.textContent=selected?'After preview':'Current board'

  const mine=state?.players.find(p=>p.id===myId)
  const next=state&&state.status==='playing'
    ?JSON.stringify([myId,state.revision,state.board,mine?.rack,selected?.placements])
    :''
  if(next===key){paint();updateStatus();return}

  key=next
  request++
  clearTimeout(timer)
  worker?.postMessage({type:'cancel'})
  results={}
  clearPaint()
  panel.removeAttribute('aria-busy')

  if(!next){status.textContent='';return}
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
  },120)
}

document.addEventListener('pointerdown',e=>{if(!e.target.closest('.heat-hit,.heat-tooltip'))hideTip()})
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip()})
window.addEventListener('resize',positionTip)
window.addEventListener('scroll',positionTip,true)
