import Serverless_Lobby from 'https://farzher.com/assets/serverless_lobby.js'
import {SIZE, PREMIUM, LETTER_SCORES, DISTRIBUTION, Lexicon, generateMoves, createGame, publicState, processAction, keyOfMove, normalizeTimerConfig} from './game.js'

import {sound, toggleSound, soundEnabled, unlockAudio} from './sounds.js'
import {initThreats,updateThreats,prefetchThreats} from './threat-ui.js?v=ev-progressive2'

const DICTIONARY_URL='https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt'
const DIRECTORY_CHANNEL='openbook-scrabble:directory'
const DIRECTORY_TTL=12_000
const $=s=>document.querySelector(s)
const els={
  landing:$('#landing'),game:$('#game'),name:$('#nameInput'),roomInput:$('#roomInput'),
  create:$('#createBtn'),join:$('#joinBtn'),lobbyList:$('#lobbyList'),presence:$('#presenceText'),resume:$('#resumeBtn'),resumeLabel:$('#resumeLabel'),timerPreset:$('#timerPresetBtn'),timerPresetMode:$('#timerPresetMode'),timerPresetTime:$('#timerPresetTime'),
  board:$('#board'),rack:$('#rack'),players:$('#players'),bagCount:$('#bagCount'),bagMeter:$('#bagMeter'),unseenCount:$('#unseenCount'),oppRackCount:$('#oppRackCount'),blankCount:$('#blankCount'),tileTracker:$('#tileTracker'),statGrid:$('#statGrid'),statsBtn:$('#statsBtn'),
  history:$('#history'),moves:$('#movesList'),moveCount:$('#moveCount'),turn:$('#turnBanner'),connection:$('#connection'),
  roomCode:$('#roomCode'),copy:$('#copyRoomBtn'),clockStrip:$('#clockStrip'),play:$('#playBtn'),playScore:$('#playScore'),
  pass:$('#passBtn'),exchange:$('#exchangeBtn'),modalLayer:$('#modalLayer'),modal:$('#modal'),
  toast:$('#toast'),rules:$('#rulesBtn'),home:$('#homeBtn'),rackHint:$('#rackHint')
}

let lex=null,lexPromise=null,lobby=null,room='',myId='',role='',hostGame=null,state=null
let moves=[],moveByKey=new Map(),moveEv=new Map(),moveRows=new Map(),selected=null,visibleMoves=250,selectedExchange=new Set(),pendingExchange=null,computing=0
let directoryWs=null,directoryPulse=null,directoryReconnect=null,timerFrame=0,timerSyncAt=0,animatedRevision=-1,lastTransport='Connecting',directPingMs=null
const directoryRooms=new Map()
const DEFAULT_PREFS={mode:'farzher',standardMs:25*60_000,farzherMs:5*60_000,ettRate:.10}
let timerPrefs=loadTimerPrefs()
let roomTimer=null
let moveWorker=null,workerRequest=0
const workerJobs=new Map()
function startMoveWorker(words){
  if(!('Worker' in window))return
  try{
    moveWorker=new Worker(new URL('./move-worker.js',import.meta.url),{type:'module'})
    moveWorker.onmessage=({data})=>{
      const job=workerJobs.get(data.id)
      if(!job)return
      workerJobs.delete(data.id)
      if(data.error)job.reject(Error(data.error));else job.resolve(data.moves)
    }
    moveWorker.onerror=()=>{
      moveWorker?.terminate();moveWorker=null
      for(const job of workerJobs.values())job.reject(Error('Move worker unavailable'))
      workerJobs.clear()
    }
    moveWorker.postMessage({type:'init',words})
  }catch{moveWorker?.terminate();moveWorker=null}
}
async function findMoves(board,rack){
  if(moveWorker){
    try{
      return await new Promise((resolve,reject)=>{
        const id=++workerRequest
        workerJobs.set(id,{resolve,reject})
        try{moveWorker.postMessage({id,board,rack})}catch(error){workerJobs.delete(id);reject(error)}
      })
    }catch{/* Older browsers can still use the synchronous engine. */}
  }
  return generateMoves(board,rack,lex)
}

const uid=()=>{const a=new Uint8Array(9);crypto.getRandomValues(a);return [...a].map(x=>x.toString(36)).join('').slice(0,12)}
const directoryId=uid()
const makeRoom=()=>{const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=new Uint8Array(6);crypto.getRandomValues(a);return [...a].map(x=>chars[x%chars.length]).join('')}
const ADJECTIVES=['Sleepy','Mochi','Tiny','Cozy','Bouncy','Sunny','Silly','Lucky','Fluffy','Wiggly','Peachy','Snug','Chill','Dizzy','Nifty','Fuzzy']
const NOUNS=['Panda','Otter','Fox','Wombat','Goblin','Gecko','Bunny','Badger','Duck','Koala','Capybara','Axolotl','Raccoon','Penguin','Bean','Moth']
const funnyName=()=>{const a=new Uint32Array(2);crypto.getRandomValues(a);return `${ADJECTIVES[a[0]%ADJECTIVES.length]} ${NOUNS[a[1]%NOUNS.length]}`}
function loadTimerPrefs(){
  try{
    const p={...DEFAULT_PREFS,...JSON.parse(localStorage.getItem('openbook-timer')||'{}')}
    if(!['standard','farzher','off'].includes(p.mode))p.mode=DEFAULT_PREFS.mode
    p.standardMs=Math.max(60_000,Math.min(60*60_000,Number(p.standardMs)||DEFAULT_PREFS.standardMs))
    p.farzherMs=Math.max(60_000,Math.min(60*60_000,Number(p.farzherMs)||DEFAULT_PREFS.farzherMs))
    p.ettRate=Math.max(.01,Math.min(.5,Number(p.ettRate)||DEFAULT_PREFS.ettRate))
    return p
  }catch{return {...DEFAULT_PREFS}}
}
function saveTimerPrefs(){
  localStorage.setItem('openbook-timer',JSON.stringify(timerPrefs))
  renderTimerPreset()
}
function selectedTimer(){
  if(timerPrefs.mode==='off')return {mode:'off'}
  return normalizeTimerConfig({
    mode:timerPrefs.mode,
    initialMs:timerPrefs.mode==='farzher'?timerPrefs.farzherMs:timerPrefs.standardMs,
    ettRate:timerPrefs.ettRate
  })
}
function formatClock(ms,compact=false){
  const neg=ms<0;ms=Math.abs(ms)
  const total=Math.ceil(ms/1000),m=Math.floor(total/60),sec=total%60
  if(compact&&m>=60)return`${Math.floor(m/60)}h ${m%60}m`
  return`${neg?'-':''}${m}:${String(sec).padStart(2,'0')}`
}
function timerLabel(config=selectedTimer()){
  if(!config||config.mode==='off')return {mode:'No timer',time:'∞'}
  return {mode:config.mode==='farzher'?'Farzher':'Standard',time:formatClock(config.initialMs)}
}
function renderTimerPreset(){
  const x=timerLabel()
  els.timerPresetMode.textContent=x.mode
  els.timerPresetTime.textContent=x.time
}

const saveName=n=>localStorage.setItem('openbook-name',n)
const currentName=()=>{
  let n=(els.name.value||'').trim().slice(0,18)
  if(!n)n=localStorage.getItem('openbook-name')||funnyName()
  els.name.value=n
  saveName(n)
  return n
}
const toast=msg=>{els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),2800)}
const escapeHtml=s=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))

function buildDemo(){
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
    const i=document.createElement('i'),p=PREMIUM[r][c]
    if(p)i.className=p
    $('#demoGrid').append(i)
  }
}
function buildBoard(){
  const premiumNames={tw:'Triple Word',dw:'Double Word',tl:'Triple Letter',dl:'Double Letter'}
  els.board.innerHTML=''
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
    const d=document.createElement('div'),p=PREMIUM[r][c]
    d.className=`cell ${p||''} ${r===7&&c===7?'center':''}`
    d.dataset.r=r;d.dataset.c=c
    d.dataset.premium=r===7&&c===7?'★':p?p.toUpperCase():''
    d.title=`${String.fromCharCode(65+c)}${r+1}${p?' · '+premiumNames[p]:''}`
    els.board.append(d)
  }
}
function tileEl(letter,blank=false){
  const d=document.createElement('div')
  d.className='tile'+(blank?' blank':'')
  d.innerHTML=`${blank?(letter||'★'):letter}<small>${blank?'':LETTER_SCORES[letter]}</small>`
  return d
}

async function loadLexicon(quiet=false){
  if(lex)return lex
  if(!quiet){
    els.create.disabled=els.join.disabled=true
    const label=els.create.querySelector('b')
    if(label)label.textContent='Loading…'
  }
  if(!lexPromise)lexPromise=(async()=>{
    const cached=sessionStorage.getItem('enable-words')
    const text=cached||await fetch(DICTIONARY_URL).then(r=>{if(!r.ok)throw Error('Dictionary download failed');return r.text()})
    if(!cached)try{sessionStorage.setItem('enable-words',text)}catch{}
    const words=text.split(/\r?\n/)
    lex=new Lexicon(words)
    startMoveWorker(words)
    initThreats(words)
    return lex
  })().catch(e=>{lexPromise=null;throw e})
  try{
    return await lexPromise
  }catch(e){
    console.error(e)
    if(!quiet)toast('Wordbook unavailable')
    throw e
  }finally{
    if(!quiet){
      els.create.disabled=els.join.disabled=false
      const label=els.create.querySelector('b')
      if(label)label.textContent='New game'
    }
  }
}

// Lightweight room directory: presence only. Games still use Serverless_Lobby.
function directorySend(data){
  if(directoryWs?.readyState===WebSocket.OPEN){
    directoryWs.send(JSON.stringify(['pub',DIRECTORY_CHANNEL,{...data,sender:directoryId}]))
  }
}
function isOpenHost(){return role==='host'&&room&&!hostGame}
function advertiseRoom(){
  if(isOpenHost())directorySend({t:'room',room,name:currentName(),timer:roomTimer||selectedTimer()})
}
function closeRoomListing(code=room){
  if(code)directorySend({t:'close',room:code})
}
function renderDirectory(){
  const now=Date.now()
  for(const [code,x] of directoryRooms)if(now-x.seen>DIRECTORY_TTL)directoryRooms.delete(code)
  const open=[...directoryRooms.values()].sort((a,b)=>b.seen-a.seen)
  els.presence.textContent=open.length?`${open.length} open`:'No open games'
  if(!open.length){
    els.lobbyList.innerHTML='<div class="lobby-empty"><i>◇</i><span>No open games</span></div>'
    return
  }
  els.lobbyList.innerHTML=open.map(x=>`
    <button class="lobby-row" data-room="${x.room}">
      <span class="lobby-live"><i></i></span>
      <span class="lobby-who"><b>${escapeHtml(x.name||'Player')}</b><small>${x.room} · ${x.timer?.mode==='farzher'?'FARZHER '+formatClock(x.timer.initialMs):x.timer?.mode==='off'?'NO TIMER':formatClock(x.timer?.initialMs||25*60_000)}</small></span>
      <span class="lobby-join">Join <b>→</b></span>
    </button>
  `).join('')
}
function connectDirectory(){
  clearTimeout(directoryReconnect)
  if(directoryWs&&directoryWs.readyState<2)return
  const ws=new WebSocket('wss://farzher.com/ws')
  directoryWs=ws
  ws.onopen=()=>{
    ws.send(JSON.stringify(['sub',DIRECTORY_CHANNEL]))
    directorySend({t:'query'})
    advertiseRoom()
    clearInterval(directoryPulse)
    directoryPulse=setInterval(()=>{
      if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(['h']))
      advertiseRoom()
      renderDirectory()
    },4000)
    setTimeout(renderDirectory,700)
  }
  ws.onmessage=e=>{
    try{
      const [topic,data]=JSON.parse(e.data)
      if(topic!==DIRECTORY_CHANNEL||!data||data.sender===directoryId)return
      if(data.t==='query'){advertiseRoom();return}
      if(data.t==='close'){
        directoryRooms.delete(String(data.room||'').toUpperCase())
        renderDirectory()
        return
      }
      if(data.t==='room'){
        const code=String(data.room||'').toUpperCase()
        if(!/^[A-Z2-9]{6,8}$/.test(code))return
        directoryRooms.set(code,{room:code,name:String(data.name||'Player').slice(0,18),timer:normalizeTimerConfig(data.timer||{}),seen:Date.now()})
        renderDirectory()
      }
    }catch{}
  }
  ws.onclose=()=>{
    if(directoryWs!==ws)return
    clearInterval(directoryPulse)
    directoryReconnect=setTimeout(connectDirectory,1800)
  }
}

function showGame(){
  els.landing.classList.add('hidden');els.game.classList.remove('hidden')
  els.roomCode.textContent=room
  history.replaceState(null,'',`${location.pathname}?room=${room}`)
}
function connection(text,online=false,relay=false){
  if(text!=='Direct'||lastTransport!=='Direct')directPingMs=null
  lastTransport=text
  const display=text==='Direct'&&Number.isFinite(directPingMs)?`Direct · ${Math.round(directPingMs)} ms`:text
  els.connection.classList.toggle('online',online)
  els.connection.classList.toggle('relay',relay)
  els.connection.title=display
  const label=els.connection.querySelector('span')
  if(label)label.textContent=display
}
function persistHost(){
  if(role==='host'&&hostGame)localStorage.setItem(`openbook-host-${room}`,JSON.stringify({myId,game:hostGame}))
}
function persistIdentity(){
  localStorage.setItem(`openbook-player-${room}`,JSON.stringify({myId,role,name:currentName()}))
  localStorage.setItem('openbook-recent-room',room)
}
function recentRoom(){
  const code=localStorage.getItem('openbook-recent-room')
  if(!code)return null
  const saved=parse(localStorage.getItem(`openbook-player-${code}`))
  return saved?.myId?{code,saved}:null
}
function renderResume(){
  const recent=recentRoom()
  els.resume.classList.toggle('hidden',!recent)
  if(!recent)return
  const host=safeParse(localStorage.getItem(`openbook-host-${recent.code}`))
  const status=host?.game?.status
  els.resumeLabel.textContent=`${status==='finished'?'Review':'Resume'} · ${recent.code}`
}
function safeParse(s){try{return JSON.parse(s)}catch{return null}}
function send(msg){lobby?.send(msg)}
function sendState(targetId=null){
  if(!hostGame)return
  for(const p of hostGame.players){
    if(targetId&&p.id!==targetId)continue
    if(p.id===myId)continue
    send({t:'state',to:p.id,state:publicState(hostGame,p.id)})
  }
}

function connectLobby(){
  if(lobby)lobby.close()
  lobby=new Serverless_Lobby(`openbook-scrabble:${room}`,{id:myId})
  lobby.onchange=(type,id,status)=>{
    if(type==='server')connection(status?(lastTransport==='Connecting'?'Online':lastTransport):'Reconnecting…',status,lastTransport==='Relay')
    if(type==='p2p')connection(status?'Direct':'Relay',true,!status)
    if(type==='peer'&&status){
      if(role==='guest')send({t:'join',name:currentName(),id:myId})
      else if(role==='host'&&hostGame&&hostGame.players.some(p=>p.id===id))sendState(id)
    }
  }
  lobby.onping=(id,ms)=>{
    if(lastTransport!=='Direct'||!Number.isFinite(ms))return
    directPingMs=ms
    connection('Direct',true,false)
  }
  lobby.onmsg=(msg,from,method)=>{connection(method==='P2P'?'Direct':'Relay',true,method!=='P2P');onMessage(msg,from)}
}

function onMessage(msg,from){
  if(!msg||typeof msg!=='object')return
  if(msg.to&&msg.to!==myId)return
  if(role==='host'){
    if(msg.t==='join'){
      if(hostGame){
        const known=hostGame.players.find(p=>p.id===from)
        if(known){sendState(from);return}
        send({t:'full',to:from});return
      }
      closeRoomListing(room)
      hostGame=createGame(myId,currentName(),from,String(msg.name||'Player').slice(0,18)||'Player',{timer:roomTimer||selectedTimer()})
      persistHost();sendState();setState(publicState(hostGame,myId));return
    }
    if(msg.t==='rename'){
      const p=hostGame?.players.find(p=>p.id===from)
      const name=String(msg.name||'').trim().slice(0,18)
      if(p&&name){p.name=name;persistHost();sendState();setState(publicState(hostGame,myId))}
      return
    }
    if(msg.t==='action')handleAuthoritativeAction(from,msg.action)
    if(msg.t==='sync')sendState(from)
  }else{
    if(msg.t==='state')setState(msg.state)
    if(msg.t==='error'){pendingExchange=null;toast(msg.error);if(msg.state)setState(msg.state)}
    if(msg.t==='full'){toast('Room is full');setTimeout(goHome,700)}
  }
}

function handleAuthoritativeAction(playerId,action){
  const out=processAction(hostGame,playerId,action,lex)
  if(!out.ok){
    if(out.changed){
      persistHost();sendState();setState(publicState(hostGame,myId))
    }else{
      send({t:'error',to:playerId,error:out.error,state:publicState(hostGame,playerId)})
      if(playerId===myId)toast(out.error)
    }
    return
  }
  persistHost();sendState();setState(publicState(hostGame,myId))
}
function act(action){
  if(!state||state.status!=='playing')return
  action={...action,revision:state.revision}
  if(role==='host')handleAuthoritativeAction(myId,action)
  else send({t:'action',action})
}

function setState(next){
  if(!next||next.you!==myId)return
  const changed=!state||next.revision!==state.revision
  if(changed&&state){
    const mine=next.players.findIndex(p=>p.id===myId)
    const last=next.history?.[next.history.length-1]
    sound(next.status==='finished'?'finish':next.turn===mine?'turn':last?.type)
  }
  let swapResult=null
  if(pendingExchange&&changed){
    const myIndex=next.players.findIndex(p=>p.id===myId)
    const last=next.history?.[next.history.length-1]
    if(last?.type==='exchange'&&last.player===myIndex){
      const after=next.players[myIndex]?.rack||[]
      const kept=[...pendingExchange.before]
      for(const t of pendingExchange.outgoing){const i=kept.indexOf(t);if(i>=0)kept.splice(i,1)}
      const incoming=[...after]
      for(const t of kept){const i=incoming.indexOf(t);if(i>=0)incoming.splice(i,1)}
      swapResult={outgoing:pendingExchange.outgoing,incoming}
    }
    pendingExchange=null
  }
  state=next;timerSyncAt=performance.now()
  if(changed){selected=null;visibleMoves=250;moveEv.clear();moveRows.clear();els.playScore.textContent=''}
  render();startClockRendering()
  if(changed)computeMoves()
  if(swapResult)setTimeout(()=>showSwapResult(swapResult),120)
}

function render(){
  if(!state){
    els.turn.textContent=role==='host'?'Share your room link to invite a friend':'Joining your game…'
    els.players.innerHTML='';els.rack.innerHTML='';els.history.innerHTML='';$('#compactScores').innerHTML=''
    els.tileTracker.innerHTML='';els.statGrid.innerHTML='';els.rackHint.textContent=''
    els.moves.innerHTML='<div class="moves-empty"><span class="empty-symbol">◇</span><b>A little company?</b><p>Your wordbook opens when both players are here. Invite a friend using the room button above.</p></div>'
    els.moveCount.textContent='—'
    els.play.disabled=els.pass.disabled=els.exchange.disabled=true
    buildBoard();updatePreview();return
  }
  const me=state.players.find(p=>p.id===myId)
  const myIndex=state.players.findIndex(p=>p.id===myId)
  const myTurn=state.status==='playing'&&state.turn===myIndex
  els.players.innerHTML=state.players.map((p,i)=>`
    <div class="player-card ${state.turn===i&&state.status==='playing'?'active':''}">
      <div class="player-identity">${p.id===myId?`<button class="player-name editable" data-rename title="Rename yourself"><b>${escapeHtml(p.name)}</b><i>✎</i></button>`:`<div class="player-name"><b>${escapeHtml(p.name)}</b></div>`}<small>${p.rackCount} tiles${p.id===myId?' · you':''}</small></div>
      <div class="player-values"><strong>${p.score}</strong><em data-side-clock="${i}"></em></div>
    </div>
  `).join('')
  $('#compactScores').innerHTML=state.players.map((p,i)=>`<span class="${state.turn===i&&state.status==='playing'?'active':''}"><span>${p.id===myId?'You':escapeHtml(p.name)}</span><b>${p.score}</b></span>`).join('')
  els.bagCount.textContent=state.bagCount
  els.bagMeter.style.width=`${state.bagCount/86*100}%`
  if(state.status==='finished')els.turn.textContent=finishText()
  else if(myTurn)els.turn.innerHTML='<i class="turn-pulse"></i><b>Your turn</b>'
  else els.turn.innerHTML=`<i class="turn-pulse opponent"></i><b>${escapeHtml(state.players[state.turn]?.name||'Opponent')}</b><span class="thinking"><i></i><i></i><i></i></span>`
  els.turn.classList.toggle('mine',myTurn)
  els.pass.disabled=els.exchange.disabled=!myTurn
  els.play.disabled=!myTurn||!selected
  renderBoard();renderRack(me?.rack||[]);renderStrategyStats();renderHistory();renderMoves();updatePreview()
  if(state.status==='finished'&&!document.body.dataset.finished){
    document.body.dataset.finished='1'
    setTimeout(showFinished,250)
  }
}
function finishText(){
  const end=state.history?.[state.history.length-1]
  const a=state.players[0],b=state.players[1]
  if(a.score===b.score)return`Tie · ${a.score}`
  const w=a.score>b.score?a:b
  return`${w.name} wins · ${w.score}–${w===a?b.score:a.score}`
}
// Board selection always uses legal current-rack moves, never forecast examples.
function chooseSquare(cell){
  if(!state||state.status!=='playing'||state.players[state.turn]?.id!==myId)return
  const r=Number(cell.dataset.r),c=Number(cell.dataset.c)
  const candidates=moves.filter(m=>m.placements.some(p=>p.r===r&&p.c===c)).sort((a,b)=>b.score-a.score)
  if(!candidates.length){toast(moves.length?'No available play on that square.':'No plays ready yet.');return}
  const current=selected?candidates.findIndex(m=>keyOfMove(m)===keyOfMove(selected)):-1
  const next=candidates[(current+1)%candidates.length]
  chooseMove(next)
}
els.board.addEventListener('click',e=>{const cell=e.target.closest('.cell');if(cell)chooseSquare(cell)})
els.board.addEventListener('keydown',e=>{
  const cell=e.target.closest('.cell');if(!cell)return
  if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseSquare(cell)}
  const delta={ArrowRight:1,ArrowLeft:-1,ArrowDown:15,ArrowUp:-15}[e.key]
  if(delta){e.preventDefault();const i=Number(cell.dataset.r)*15+Number(cell.dataset.c);els.board.children[Math.max(0,Math.min(224,i+delta))]?.focus()}
})
function renderBoard(){
  const preview=new Map((selected?.placements||[]).map(p=>[`${p.r},${p.c}`,p]))
  const last=new Set((state.lastPlay||[]).map(x=>x.join(',')))
  const animate=state.revision!==animatedRevision
  for(const cell of els.board.children){
    const r=+cell.dataset.r,c=+cell.dataset.c,k=`${r},${c}`
    cell.innerHTML=''
    cell.setAttribute('role','button')
    cell.tabIndex=r===7&&c===7?0:-1
    cell.setAttribute('aria-label',`${String.fromCharCode(65+c)}${r+1}${state.board[r][c]?`: ${state.board[r][c].letter}`:': preview best play; click again for next'}`)
    cell.classList.toggle('last-play',last.has(k))
    const p=preview.get(k),b=state.board[r][c]
    if(b){
      const t=tileEl(b.letter,b.blank)
      if(animate&&last.has(k))t.classList.add('fresh')
      cell.append(t)
    }else if(p){
      const t=tileEl(p.letter,p.blank);t.classList.add('preview');cell.append(t)
    }
  }
  animatedRevision=state.revision
}
function renderRack(rack){
  els.rack.innerHTML=''
  const used=(selected?.placements||[]).map(p=>p.blank?'?':p.letter)
  rack.forEach((l,i)=>{
    const t=tileEl(l==='?'?'':l,l==='?');t.dataset.i=i
    const index=used.indexOf(l)
    if(index>=0){t.classList.add('in-preview');used.splice(index,1)}
    els.rack.append(t)
  })
  els.rackHint.textContent=selected?`${selected.placements.length} tiles in preview`:(state&&state.turn===state.players.findIndex(p=>p.id===myId)?'Choose a play':'')
}
function unseenTiles(){
  const counts={...DISTRIBUTION}
  for(const row of state.board)for(const cell of row)if(cell)counts[cell.blank?'?':cell.letter]--
  const mine=state.players.find(p=>p.id===myId)?.rack||[]
  for(const tile of mine)counts[tile]--
  return counts
}
function gameNumbers(){
  const turns=(state.history||[]).filter(h=>h.type==='play'||h.type==='pass'||h.type==='exchange')
  const plays=turns.filter(h=>h.type==='play')
  const best=plays.reduce((a,h)=>!a||h.score>a.score?h:a,null)
  return {
    turns:turns.length,
    best,
    bingos:plays.filter(h=>h.tiles===7).length,
    scoreless:state.scoreless||0
  }
}
function trackerMarkup(){
  if(!state)return''
  const counts=unseenTiles(),letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ?'.split('')
  return letters.map(letter=>{
    const n=Math.max(0,counts[letter]||0),label=letter==='?'?'★':letter
    return `<div class="track-tile ${n===0?'gone':''} ${LETTER_SCORES[letter]>=5?'hot':''}" title="${letter==='?'?'Blank':letter}: ${n} unseen"><b>${label}</b><span>${n}</span></div>`
  }).join('')
}
function statsMarkup(){
  if(!state)return''
  const me=state.players.find(p=>p.id===myId),opp=state.players.find(p=>p.id!==myId),nums=gameNumbers()
  const lead=(me?.score||0)-(opp?.score||0)
  return `
    <div class="stat"><span>Lead</span><b class="${lead>0?'positive':lead<0?'negative':''}">${lead===0?'—':lead>0?'+'+lead:lead}</b></div>
    <div class="stat"><span>Turns</span><b>${nums.turns}</b></div>
    <div class="stat"><span>Best</span><b>${nums.best?nums.best.score:'—'}</b></div>
    <div class="stat"><span>Bingos</span><b>${nums.bingos}</b></div>
    <div class="stat wide"><span>Scoreless</span><b>${nums.scoreless}<small>/ 6</small></b><i><em style="width:${Math.min(100,nums.scoreless/6*100)}%"></em></i></div>
  `
}
function renderStrategyStats(){
  if(!state)return
  const counts=unseenTiles(),opp=state.players.find(p=>p.id!==myId)
  const unseen=Object.values(counts).reduce((a,b)=>a+Math.max(0,b),0)
  els.unseenCount.textContent=unseen
  els.oppRackCount.textContent=opp?.rackCount??'—'
  els.blankCount.textContent=Math.max(0,counts['?']||0)
  els.tileTracker.innerHTML=trackerMarkup()
  els.statGrid.innerHTML=statsMarkup()
}
function showStats(){
  if(!state)return
  const counts=unseenTiles(),opp=state.players.find(p=>p.id!==myId)
  const unseen=Object.values(counts).reduce((a,b)=>a+Math.max(0,b),0)
  openModal(`<div class="stats-modal"><div class="modal-kicker">STRATEGY</div><h2>Game stats</h2><div class="mobile-stat-summary"><span><b>${state.bagCount}</b> Bag</span><span><b>${opp?.rackCount??'—'}</b> Opp rack</span><span><b>${unseen}</b> Unseen</span><span><b>${Math.max(0,counts['?']||0)}</b> Blanks</span></div><div class="modal-tracker">${trackerMarkup()}</div><div class="modal-stat-grid">${statsMarkup()}</div><div class="modal-actions"><button class="primary" data-close>Done</button></div></div>`)
}

function renderHistory(){
  const hs=state.history||[]
  if(!hs.length){els.history.innerHTML='<div class="history-empty">A fresh board.<br>Your story starts with the first word.</div>';return}
  els.history.innerHTML=[...hs].reverse().map(h=>{
    if(h.type==='end')return'<div class="history-entry"><b>Game over</b></div>'
    const p=state.players[h.player]?.name||'Player'
    if(h.type==='play')return`<div class="history-entry"><div><b>${escapeHtml(h.word)}</b><span>${escapeHtml(p)}</span></div><strong>+${h.score}</strong></div>`
    if(h.type==='exchange')return`<div class="history-entry"><div><b>Swap</b><span>${escapeHtml(p)}</span></div><strong>0</strong></div>`
    return`<div class="history-entry"><div><b>Pass</b><span>${escapeHtml(p)}</span></div><strong>0</strong></div>`
  }).join('')
}

async function computeMoves(){
  const run=++computing,mine=state?.players.find(p=>p.id===myId),myIndex=state?.players.findIndex(p=>p.id===myId)
  moves=[];selected=null
  if(!mine?.rack||state.status!=='playing'||state.turn!==myIndex){renderMoves();return}
  els.moves.innerHTML='<div class="moves-empty">Finding your possibilities…<div class="loading-line"><i></i></div></div>'
  els.moveCount.textContent='…'
  await new Promise(r=>setTimeout(r,15))
  if(run!==computing||!state)return
  const found=await findMoves(state.board,mine.rack)
  if(run!==computing||!state)return
  moves=found
  moveByKey=new Map(moves.map(m=>[keyOfMove(m),m]))
  moveEv.clear()
  renderMoves()
}
function applyMoveEvRow(moveKey){
  const row=moveRows.get(moveKey),ev=moveEv.get(moveKey)
  if(!row)return
  if(!ev){
    row.classList.add('ev-pending')
    row.classList.remove('ev-ready','ev-neutral','ev-complete')
    row.style.setProperty('--move-ev-progress','0%')
    row.style.removeProperty('--move-ev-bg')
    row.style.removeProperty('--move-ev-edge')
    row.style.removeProperty('--move-ev-progress-color')
    row.title='EV queued'
    return
  }

  const diff=ev.diff
  const samples=Math.max(1,ev.samples||1)
  const confidence=Math.min(1,Math.sqrt(samples/24))
  const progress=ev.done?100:Math.min(99,Math.sqrt(samples/96)*100)
  const neutral=Math.abs(diff)<.5
  const strength=Math.min(1,Math.abs(diff)/25)*confidence

  row.classList.remove('ev-pending')
  row.classList.add('ev-ready')
  row.classList.toggle('ev-neutral',neutral)
  row.classList.toggle('ev-complete',!!ev.done)
  row.style.setProperty('--move-ev-progress',`${progress.toFixed(1)}%`)

  if(neutral){
    row.style.setProperty('--move-ev-bg','linear-gradient(90deg,rgba(181,195,187,.055),rgba(181,195,187,.012) 72%,transparent)')
    row.style.setProperty('--move-ev-edge','rgba(183,199,190,.30)')
    row.style.setProperty('--move-ev-progress-color','rgba(185,202,192,.72)')
  }else{
    const blue=diff>0
    const alpha=.035+strength*.20
    const edge=.28+strength*.52
    row.style.setProperty('--move-ev-bg',blue
      ?`linear-gradient(90deg,rgba(73,154,255,${alpha}),rgba(73,154,255,${alpha*.18}) 70%,transparent)`
      :`linear-gradient(90deg,rgba(255,103,93,${alpha}),rgba(255,103,93,${alpha*.18}) 70%,transparent)`)
    row.style.setProperty('--move-ev-edge',blue?`rgba(91,170,255,${edge})`:`rgba(255,113,103,${edge})`)
    row.style.setProperty('--move-ev-progress-color',blue?'rgba(100,178,255,.88)':'rgba(255,126,116,.88)')
  }
  row.title=`Board EV ${ev.you.toFixed(1)} vs ${ev.opponent.toFixed(1)} · ${diff>=0?'+':''}${diff.toFixed(1)} · ${ev.done?'refined':ev.samples+' / 96 samples'}`
}
function bindMoveRows(){
  moveRows=new Map()
  for(const row of els.moves.querySelectorAll('.move-row[data-key]')){
    const moveKey=decodeURIComponent(row.dataset.key)
    moveRows.set(moveKey,row)
    applyMoveEvRow(moveKey)
  }
}
document.addEventListener('openbook-move-ev',e=>{
  const ev=e.detail
  if(!ev||ev.revision!==state?.revision)return
  moveEv.set(ev.moveKey,ev)
  applyMoveEvRow(ev.moveKey)
})

function renderMoves(){
  if(!state)return
  const focusedKey=els.moves.contains(document.activeElement)?document.activeElement.dataset.key:null
  const myIndex=state.players.findIndex(p=>p.id===myId),myTurn=state.status==='playing'&&state.turn===myIndex
  if(!myTurn){
    els.moveCount.textContent='—'
    els.moves.innerHTML=`<div class="moves-empty"><span class="empty-symbol">${state.status==='finished'?'✦':'◷'}</span><b>${state.status==='finished'?'Well played.':'Their turn to make a move'}</b><p>${state.status==='finished'?'Explore the board and game insights.':'Your available moves will appear here when it’s your turn.'}</p></div>`
    return
  }

  const list=[...moves].sort((a,b)=>b.score-a.score||a.word.localeCompare(b.word)||coord(a).localeCompare(coord(b)))
  els.moveCount.textContent=list.length
  if(!list.length){
    els.moves.innerHTML='<div class="moves-empty">No legal plays. Swap tiles or pass to continue.</div>'
    return
  }

  const shown=list.slice(0,visibleMoves)
  const selectedKey=selected?keyOfMove(selected):''
  els.moves.innerHTML=shown.map(m=>{
    const moveKey=keyOfMove(m),active=moveKey===selectedKey
    return `<button class="move-row ${active?'selected':''} ev-pending" data-key="${encodeURIComponent(moveKey)}">
      <div class="move-copy">
        <div class="move-word">${m.word}</div>
        <div class="move-meta">${coord(m)}${m.placements.length===7?' · BINGO':''}</div>
      </div>
      <div class="move-score">${m.score}</div>
      <span class="move-ev-progress" aria-hidden="true"><i></i></span>
    </button>`
  }).join('')+(shown.length<list.length?`<button class="more-words" data-more>+${Math.min(250,list.length-shown.length)} more moves</button>`:'')
  bindMoveRows()
  prefetchThreats(state,shown,myId)
  if(focusedKey){
    const target=[...els.moves.querySelectorAll('[data-key]')].find(b=>b.dataset.key===focusedKey)
    target?.focus({preventScroll:true})
  }
}
function coord(m){
  const p=m.placements.slice().sort((a,b)=>a.r-b.r||a.c-b.c)[0]
  return`${String.fromCharCode(65+p.c)}${p.r+1}${m.direction==='V'?' ↓':' →'}`
}
function previewMove(m,{refreshMoves=false,withSound=false}={}){
  if(!m||selected&&keyOfMove(selected)===keyOfMove(m))return
  selected=m
  els.play.disabled=false
  els.playScore.textContent=`+${m.score}`
  if(withSound)sound('select')
  renderBoard()
  renderRack(state.players.find(p=>p.id===myId)?.rack||[])
  updatePreview()
  if(refreshMoves)renderMoves()
}
function chooseMove(m){previewMove(m,{refreshMoves:true,withSound:true})}
function updatePreview(){
  updateThreats(state,selected,myId)
  const mine=state?.status==='playing'&&state.players[state.turn]?.id===myId
  $('#previewBar').classList.toggle('has-preview',!!selected)
  $('#previewText').innerHTML=selected?`<b>${selected.word}</b><span>${coord(selected)} · ${selected.placements.length} tiles</span><strong>+${selected.score} <small>pts</small></strong>`:mine?'Click a square or choose a word to preview':state?.status==='finished'?'Game complete — nicely played.':'Your next move is worth the wait.'
  $('#clearPreview').classList.toggle('hidden',!selected)
  $('#mobilePreview').classList.toggle('hidden',!selected||els.game.classList.contains('hidden'))
  $('#mobilePreviewWord').textContent=selected?.word||''
  $('#mobilePreviewScore').textContent=selected?`+${selected.score} points`:''
}
function clearPreview(){
  selected=null;els.play.disabled=true;els.playScore.textContent=''
  if(state){renderBoard();renderRack(state.players.find(p=>p.id===myId)?.rack||[]);renderMoves()}
  updatePreview()
}
let modalReturnFocus=null
function openModal(html){
  if(els.modalLayer.classList.contains('hidden'))modalReturnFocus=document.activeElement
  els.modal.onclick=null
  els.modal.innerHTML=html;els.modalLayer.classList.remove('hidden')
  els.modal.focus()
}
function closeModal(){
  els.modalLayer.classList.add('hidden');els.modal.onclick=null
  if(modalReturnFocus?.isConnected)modalReturnFocus.focus()
}
function rackChip(letter){
  return `<span class="swap-chip">${letter==='?'?'★':letter}<small>${letter==='?'?'':LETTER_SCORES[letter]}</small></span>`
}
function showExchange(){
  const me=state.players.find(p=>p.id===myId)
  selectedExchange.clear()
  openModal(`<div class="swap-modal">
    <div class="modal-kicker">YOUR TURN</div>
    <h2>Swap tiles</h2>
    <p>Choose the tiles to put back. You’ll draw the same number of random replacements.</p>
    <div class="swap-heading"><span>Your rack</span><b id="swapCount">0 selected</b></div>
    <div class="exchange-grid" id="exchangeGrid"></div>
    <div class="swap-return"><span>Returning</span><div id="swapReturning" class="swap-chips"><em>Choose tiles above</em></div></div>
    <div class="swap-note"><i>↻</i><span><b id="swapDrawCount">0</b> random replacements · <b>${state.bagCount}</b> tiles in bag</span></div>
    <div class="modal-actions"><button class="ghost" data-close>Cancel</button><button class="primary" id="confirmExchange" disabled>Swap</button></div>
  </div>`)
  const grid=$('#exchangeGrid'),count=$('#swapCount'),returning=$('#swapReturning'),draw=$('#swapDrawCount'),confirm=$('#confirmExchange')
  const refresh=()=>{
    const indices=[...selectedExchange].sort((a,b)=>a-b)
    const tiles=indices.map(i=>me.rack[i])
    count.textContent=`${tiles.length} selected`
    draw.textContent=tiles.length
    returning.innerHTML=tiles.length?tiles.map(rackChip).join(''):'<em>Choose tiles above</em>'
    confirm.disabled=!tiles.length
    confirm.textContent=tiles.length?`Swap ${tiles.length} tile${tiles.length===1?'':'s'}`:'Swap'
  }
  me.rack.forEach((l,i)=>{
    const t=tileEl(l==='?'?'':l,l==='?');t.dataset.i=i;t.tabIndex=0;t.setAttribute('role','button');t.setAttribute('aria-label',`Swap ${l==='?'?'blank':l}`)
    const toggle=()=>{
      if(selectedExchange.has(i))selectedExchange.delete(i);else selectedExchange.add(i)
      t.classList.toggle('selected',selectedExchange.has(i));refresh()
    }
    t.onclick=toggle
    t.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}}
    grid.append(t)
  })
  confirm.onclick=()=>{
    const outgoing=[...selectedExchange].sort((a,b)=>a-b).map(i=>me.rack[i])
    pendingExchange={revision:state.revision,before:[...me.rack],outgoing}
    closeModal();act({type:'exchange',tiles:outgoing})
  }
}
function showSwapResult({outgoing,incoming}){
  openModal(`<div class="swap-result">
    <div class="modal-kicker">SWAP COMPLETE</div>
    <h2>New tiles</h2>
    <div class="swap-comparison">
      <div><span>Returned</span><div class="swap-chips">${outgoing.map(rackChip).join('')}</div></div>
      <i>→</i>
      <div><span>Drew</span><div class="swap-chips incoming">${incoming.map(rackChip).join('')}</div></div>
    </div>
    <div class="modal-actions"><button class="primary" data-close>Done</button></div>
  </div>`)
}
function showRename(){
  const me=state?.players.find(p=>p.id===myId)
  openModal(`<div class="rename-modal"><div class="modal-kicker">PLAYER</div><h2>Your name</h2><input id="renameInput" class="rename-input" maxlength="18" value="${escapeHtml(me?.name||currentName())}" autocomplete="off"><div class="modal-actions"><button class="ghost" data-close>Cancel</button><button class="primary" id="saveRename">Save</button></div></div>`)
  const input=$('#renameInput')
  input.focus();input.select()
  const save=()=>{
    const name=input.value.trim().slice(0,18)
    if(!name)return
    els.name.value=name;saveName(name)
    if(role==='host'){
      const p=hostGame?.players.find(p=>p.id===myId)
      if(p){p.name=name;persistHost();sendState();setState(publicState(hostGame,myId))}
      else advertiseRoom()
    }else send({t:'rename',name})
    closeModal()
  }
  $('#saveRename').onclick=save
  input.onkeydown=e=>{if(e.key==='Enter')save()}
}
function showRules(){
  openModal(`<h2>Openbook Scrabble</h2><p>Standard Scrabble, except every legal play in your rack is shown.</p><ul class="rules-list"><li>Standard board, tiles, premiums and 50-point bingo.</li><li>The first word crosses the center.</li><li>Swap only while 7+ tiles remain.</li><li>Six scoreless turns ends the game.</li><li>All publicly trackable tile statistics are shown; hidden racks stay hidden.</li><li>Click an empty square to preview its highest-scoring play. Click again to cycle alternatives; press Play to confirm. Arrow keys navigate the board; Enter previews.</li><li>The EV heatmap shows both players together: blue is you, coral-red is the opponent, and purple means overlapping opportunities. Brighter means higher EV on the same fixed 0–50+ scale for each player. Cloud edges are visually smoothed; hover or focus a square to compare both exact values. Turn the heatmap off to see the classic board.</li><li>EV averages the best complete move score placing a tile on that square over possible racks, including zero when no play exists. It is not a sum across squares or a prediction of the opponent’s choice.</li><li>Your current rack is exact. Opponent racks and refills are sampled from unseen physical tiles, including blanks. After a preview, both forecasts use the preview board; your forecast is after refill, before any opponent reply.</li><li>Wordbook: ENABLE.</li></ul><div class="modal-actions"><button class="primary" data-close>Done</button></div>`)
}
function showFinished(){
  openModal(`<h2>${escapeHtml(finishText())}</h2><div class="modal-actions"><button class="ghost" data-close>Board</button><button class="primary" id="newGame">Home</button></div>`)
  $('#newGame').onclick=goHome
}

function create(){
  loadLexicon().then(()=>{
    const n=currentName()
    room=makeRoom();role='host';myId=uid();hostGame=null;roomTimer=selectedTimer()
    persistIdentity();showGame();connectLobby();render();advertiseRoom()
  })
}
function join(code=els.roomInput.value){
  loadLexicon().then(()=>{
    code=String(code||'').trim().toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8)
    if(!code){toast('Enter a room code');return}
    currentName();room=code
    const saved=parse(localStorage.getItem(`openbook-player-${room}`))
    role=saved?.role==='host'?'host':'guest'
    myId=saved?.myId||uid()
    if(role==='host'){
      const h=parse(localStorage.getItem(`openbook-host-${room}`))
      hostGame=h?.game||null
      roomTimer=hostGame?.timer?normalizeTimerConfig(hostGame.timer):selectedTimer()
    }else roomTimer=null
    persistIdentity();showGame();connectLobby()
    if(role==='host'){
      if(hostGame)setState(publicState(hostGame,myId))
      else{render();advertiseRoom()}
    }else{
      render();setTimeout(()=>send({t:'join',name:currentName(),id:myId}),250)
    }
  })
}
function parse(s){return safeParse(s)}
function goHome(){
  if(isOpenHost())closeRoomListing(room)
  computing++
  lobby?.close();lobby=null;stopClockRendering();state=null;hostGame=null;moves=[];moveByKey.clear();moveEv.clear();moveRows.clear();selected=null;pendingExchange=null;els.playScore.textContent='';els.clockStrip.innerHTML=''
  delete document.body.dataset.finished
  room='';role='';myId='';roomTimer=null;animatedRevision=-1;lastTransport='Connecting';directPingMs=null
  els.game.classList.add('hidden');els.landing.classList.remove('hidden')
  history.replaceState(null,'',location.pathname);closeModal();updatePreview();renderDirectory();renderResume()
}


function openTimerSettings(){
  let draft={...timerPrefs}
  const draw=()=>{
    const activeMs=draft.mode==='farzher'?draft.farzherMs:draft.standardMs
    openModal(`<div class="timer-modal">
      <h2>Timer</h2>
      <div class="timer-modes">
        <button class="${draft.mode==='standard'?'selected':''}" data-tmode="standard"><b>Standard</b><span>Classic clock</span></button>
        <button class="${draft.mode==='farzher'?'selected':''}" data-tmode="farzher"><b>Farzher</b><span>Adapts to pace</span></button>
        <button class="${draft.mode==='off'?'selected':''}" data-tmode="off"><b>Off</b><span>No clock</span></button>
      </div>
      ${draft.mode==='off'?'':`<div class="timer-section"><label>Start time</label><div class="timer-choices">${[5,10,15,25].map(m=>`<button class="${activeMs===m*60_000?'selected':''}" data-minutes="${m}">${m}m</button>`).join('')}</div></div>`}
      ${draft.mode==='farzher'? `<div class="timer-section"><label>Expected turn <b>${Math.round(draft.ettRate*100)}%</b></label><div class="timer-choices">${[5,10,15,20].map(p=>`<button class="${Math.round(draft.ettRate*100)===p?'selected':''}" data-ett="${p}">${p}%</button>`).join('')}</div><small>Time spent moves between clocks; the expected turn scales with the total pool.</small></div>`:''}
      <div class="modal-actions"><button class="ghost" data-close>Cancel</button><button class="primary" id="saveTimer">Done</button></div>
    </div>`)
    els.modal.onclick=e=>{
      const mode=e.target.closest('[data-tmode]')?.dataset.tmode
      if(mode){draft.mode=mode;if(mode==='farzher'&&!draft.farzherMs)draft.farzherMs=5*60_000;draw();return}
      const mins=Number(e.target.closest('[data-minutes]')?.dataset.minutes)
      if(mins){if(draft.mode==='farzher')draft.farzherMs=mins*60_000;else draft.standardMs=mins*60_000;draw();return}
      const ett=Number(e.target.closest('[data-ett]')?.dataset.ett)
      if(ett){draft.ettRate=ett/100;draw();return}
      if(e.target.id==='saveTimer'){timerPrefs=draft;saveTimerPrefs();closeModal()}
      else if(e.target.closest('[data-close]'))closeModal()
    }
  }
  draw()
}
function projectedClocks(){
  const t=state?.timer
  if(!t||t.mode==='off'||!Array.isArray(t.clocks))return null
  const clocks=[...t.clocks]
  if(state.status!=='playing'||t.active<0)return clocks
  const elapsed=Math.max(0,performance.now()-timerSyncAt)
  clocks[t.active]-=elapsed
  if(t.mode==='farzher')for(let i=0;i<clocks.length;i++)if(i!==t.active)clocks[i]+=elapsed
  return clocks
}
function updateClocks(){
  if(!state){els.clockStrip.innerHTML='';return}
  const t=state.timer
  if(!t||t.mode==='off'){
    els.clockStrip.innerHTML=''
    document.querySelectorAll('[data-side-clock]').forEach(x=>x.textContent='')
    return
  }
  const clocks=projectedClocks()
  const mode=t.mode==='farzher'?'F':''
  const divider=t.mode==='farzher'? `<em class="ett-clock" title="Expected turn time">ETT ${formatClock(t.ettMs||0)}</em>` : '<em>·</em>'
  els.clockStrip.innerHTML=state.players.map((p,i)=>`<div class="game-clock ${t.active===i&&state.status==='playing'?'active':''} ${clocks[i]<=30_000?'low':''}"><span>${p.id===myId?'YOU':escapeHtml(p.name)}</span><b>${formatClock(clocks[i])}</b>${mode?'<i>F</i>':''}</div>`).join(divider)
  document.querySelectorAll('[data-side-clock]').forEach(x=>{const i=+x.dataset.sideClock;x.textContent=formatClock(clocks[i]);x.classList.toggle('low',clocks[i]<=30_000)})
}
function stopClockRendering(){
  clearTimeout(timerFrame)
  timerFrame=0
}
function startClockRendering(){
  stopClockRendering()
  updateClocks()

  if(!state?.timer||state.timer.mode==='off'||state.status!=='playing')return

  // Visual clock changes share real second boundaries. The timers themselves
  // remain millisecond-accurate; only their m:ss presentation is synchronized.
  const schedule=()=>{
    const delay=1000-Date.now()%1000+4
    timerFrame=setTimeout(()=>{
      updateClocks()
      if(state?.timer&&state.timer.mode!=='off'&&state.status==='playing')schedule()
      else timerFrame=0
    },delay)
  }
  schedule()

}

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&state?.timer&&state.status==='playing')startClockRendering()
})
els.players.onclick=e=>{if(e.target.closest('[data-rename]'))showRename()}
els.resume.onclick=()=>{const recent=recentRoom();if(recent)join(recent.code)}
els.statsBtn.onclick=showStats
els.timerPreset.onclick=openTimerSettings
els.create.onclick=create
els.join.onclick=()=>join()
els.roomInput.onkeydown=e=>{if(e.key==='Enter')join()}
els.roomInput.oninput=()=>els.roomInput.value=els.roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g,'')
els.lobbyList.onclick=e=>{const row=e.target.closest('[data-room]');if(row)join(row.dataset.room)}
els.name.onchange=()=>{currentName();advertiseRoom()}
els.copy.onclick=()=>navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${room}`).then(()=>toast('Invite link copied — send it to a friend')).catch(()=>toast(`Share room code: ${room}`))
els.home.onclick=()=>{
  openModal('<h2>Back to the lobby?</h2><p>You can return using Resume game. The game clock keeps running while you’re away.</p><div class="modal-actions"><button class="ghost" data-close>Stay here</button><button class="primary" id="leaveGame">Back to lobby</button></div>')
  $('#leaveGame').onclick=goHome
}
els.pass.onclick=()=>openModal('<h2>Pass this turn?</h2><p>You’ll keep your tiles and your opponent will play next.</p><div class="modal-actions"><button class="ghost" data-close>Cancel</button><button class="primary" id="confirmPass">Pass</button></div>')
els.exchange.onclick=()=>{if(state?.bagCount<7){toast('Not enough tiles');return}showExchange()}
els.play.onclick=()=>{if(selected)act({type:'play',placements:selected.placements})}
els.rules.onclick=showRules
els.modalLayer.onclick=e=>{if(e.target===els.modalLayer||e.target.closest('[data-close]'))closeModal()}
function moveFromElement(el){
  const raw=el?.dataset.key
  if(!raw)return null
  const moveKey=decodeURIComponent(raw)
  return moveByKey.get(moveKey)||null
}
els.moves.addEventListener('pointerover',e=>{
  if(e.pointerType==='touch')return
  const row=e.target.closest('.move-row')
  if(!row||row.contains(e.relatedTarget))return
  const m=moveFromElement(row)
  if(m)previewMove(m)
})
els.moves.addEventListener('focusin',e=>{
  const m=moveFromElement(e.target.closest('.move-row'))
  if(m)previewMove(m)
})
els.moves.onclick=e=>{
  if(e.target.closest('[data-more]')){visibleMoves+=250;renderMoves();return}
  const row=e.target.closest('.move-row')
  if(!row)return
  const m=moveFromElement(row)
  if(m)act({type:'play',placements:m.placements})
}
document.addEventListener('click',e=>{if(e.target?.id==='confirmPass'){closeModal();act({type:'pass'})}})
window.addEventListener('beforeunload',()=>{persistHost();if(isOpenHost())closeRoomListing(room)})

const soundButton=$('#soundBtn')
function renderSound(){
  const on=soundEnabled()
  soundButton.setAttribute('aria-pressed',String(on))
  soundButton.title=on?'Mute sounds':'Enable sounds'
  soundButton.setAttribute('aria-label',soundButton.title)
  soundButton.querySelector('span').textContent=on?'Sound on':'Sound off'
}
soundButton.onclick=()=>{toggleSound();renderSound()}
$('#clearPreview').onclick=clearPreview
$('#mobilePlay').onclick=()=>els.play.click()
if('IntersectionObserver' in window){
  new IntersectionObserver(([entry])=>$('#mobilePreview').classList.toggle('is-away',!entry.isIntersecting)).observe(els.play)
}
$('#viewBoard').onclick=()=>els.turn.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'})
for(const event of ['pointerdown','keydown'])document.addEventListener(event,unlockAudio,{capture:true})
document.addEventListener('keydown',e=>{
  if(!els.modalLayer.classList.contains('hidden')){
    if(e.key==='Escape'){e.preventDefault();closeModal();return}
    if(e.key==='Tab'){
      const items=[...els.modal.querySelectorAll('button:not(:disabled),input,[tabindex="0"]')].filter(x=>x.getClientRects().length)
      const first=items[0],last=items.at(-1)
      if(!first){e.preventDefault();return}
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===els.modal)){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===els.modal)){e.preventDefault();first.focus()}
    }
    return
  }
  if(e.key==='Escape'&&!els.game.classList.contains('hidden'))clearPreview()
})
renderSound()
buildDemo();buildBoard()
let initialName=localStorage.getItem('openbook-name')
if(!initialName){initialName=funnyName();saveName(initialName)}
els.name.value=initialName
renderTimerPreset();renderResume();connectDirectory()
const params=new URLSearchParams(location.search),invite=params.get('room')?.toUpperCase()
if(invite){
  els.roomInput.value=invite
  join(invite)
}else if('requestIdleCallback'in window)requestIdleCallback(()=>loadLexicon(true).catch(()=>{}))
else setTimeout(()=>loadLexicon(true).catch(()=>{}),800)
