import Serverless_Lobby from 'https://farzher.com/assets/serverless_lobby.js'
import {SIZE, PREMIUM, LETTER_SCORES, Lexicon, generateMoves, createGame, publicState, processAction, keyOfMove} from './game.js'

const DICTIONARY_URL='https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt'
const DIRECTORY_CHANNEL='openbook-scrabble:directory'
const DIRECTORY_TTL=12_000
const $=s=>document.querySelector(s)
const els={
  landing:$('#landing'),game:$('#game'),name:$('#nameInput'),roomInput:$('#roomInput'),
  create:$('#createBtn'),join:$('#joinBtn'),lobbyList:$('#lobbyList'),presence:$('#presenceText'),
  board:$('#board'),rack:$('#rack'),players:$('#players'),bagCount:$('#bagCount'),bagMeter:$('#bagMeter'),
  history:$('#history'),moves:$('#movesList'),moveCount:$('#moveCount'),summary:$('#wordSummary'),
  search:$('#moveSearch'),sort:$('#moveSort'),turn:$('#turnBanner'),connection:$('#connection'),
  roomCode:$('#roomCode'),copy:$('#copyRoomBtn'),play:$('#playBtn'),playScore:$('#playScore'),
  pass:$('#passBtn'),exchange:$('#exchangeBtn'),modalLayer:$('#modalLayer'),modal:$('#modal'),
  toast:$('#toast'),rules:$('#rulesBtn'),home:$('#homeBtn'),rackHint:$('#rackHint')
}

let lex=null,lexPromise=null,lobby=null,room='',myId='',role='',hostGame=null,state=null
let moves=[],selected=null,expandedWord='',visibleWords=250,selectedExchange=new Set(),computing=0
let directoryWs=null,directoryPulse=null,directoryReconnect=null
const directoryRooms=new Map()

const uid=()=>{const a=new Uint8Array(9);crypto.getRandomValues(a);return [...a].map(x=>x.toString(36)).join('').slice(0,12)}
const directoryId=uid()
const makeRoom=()=>{const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=new Uint8Array(6);crypto.getRandomValues(a);return [...a].map(x=>chars[x%chars.length]).join('')}
const ADJECTIVES=['Sleepy','Mochi','Tiny','Cozy','Bouncy','Sunny','Silly','Lucky','Fluffy','Wiggly','Peachy','Snug','Chill','Dizzy','Nifty','Fuzzy']
const NOUNS=['Panda','Otter','Fox','Wombat','Goblin','Gecko','Bunny','Badger','Duck','Koala','Capybara','Axolotl','Raccoon','Penguin','Bean','Moth']
const funnyName=()=>{const a=new Uint32Array(2);crypto.getRandomValues(a);return `${ADJECTIVES[a[0]%ADJECTIVES.length]} ${NOUNS[a[1]%NOUNS.length]}`}
const saveName=n=>localStorage.setItem('openbook-name',n)
const currentName=()=>{
  let n=(els.name.value||'').trim().slice(0,18)
  if(!n)n=localStorage.getItem('openbook-name')||funnyName()
  els.name.value=n
  saveName(n)
  return n
}
const toast=msg=>{els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),1500)}
const escapeHtml=s=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))

function buildDemo(){
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
    const i=document.createElement('i'),p=PREMIUM[r][c]
    if(p)i.className=p
    $('#demoGrid').append(i)
  }
}
function buildBoard(){
  els.board.innerHTML=''
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
    const d=document.createElement('div')
    d.className=`cell ${PREMIUM[r][c]||''} ${r===7&&c===7?'center':''}`
    d.dataset.r=r;d.dataset.c=c;els.board.append(d)
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
    lex=new Lexicon(text.split(/\r?\n/))
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
  if(isOpenHost())directorySend({t:'room',room,name:currentName()})
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
      <span class="lobby-who"><b>${escapeHtml(x.name||'Player')}</b><small>${x.room}</small></span>
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
        directoryRooms.set(code,{room:code,name:String(data.name||'Player').slice(0,18),seen:Date.now()})
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
function connection(text,online=false){
  els.connection.classList.toggle('online',online)
  els.connection.querySelector('span').textContent=text
}
function persistHost(){
  if(role==='host'&&hostGame)localStorage.setItem(`openbook-host-${room}`,JSON.stringify({myId,game:hostGame}))
}
function persistIdentity(){
  localStorage.setItem(`openbook-player-${room}`,JSON.stringify({myId,role,name:currentName()}))
}
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
    if(type==='server')connection(status?'Connected':'Reconnecting…',status)
    if(type==='peer'&&status){
      if(role==='guest')send({t:'join',name:currentName(),id:myId})
      else if(role==='host'&&hostGame&&hostGame.players.some(p=>p.id===id))sendState(id)
    }
  }
  lobby.onmsg=(msg,from)=>onMessage(msg,from)
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
      hostGame=createGame(myId,currentName(),from,String(msg.name||'Player').slice(0,18)||'Player')
      persistHost();sendState();setState(publicState(hostGame,myId));return
    }
    if(msg.t==='action')handleAuthoritativeAction(from,msg.action)
    if(msg.t==='sync')sendState(from)
  }else{
    if(msg.t==='state')setState(msg.state)
    if(msg.t==='error'){toast(msg.error);if(msg.state)setState(msg.state)}
    if(msg.t==='full'){toast('Room is full');setTimeout(goHome,700)}
  }
}

function handleAuthoritativeAction(playerId,action){
  const out=processAction(hostGame,playerId,action,lex)
  if(!out.ok){
    send({t:'error',to:playerId,error:out.error,state:publicState(hostGame,playerId)})
    if(playerId===myId)toast(out.error)
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
  state=next;selected=null;expandedWord='';visibleWords=250;els.playScore.textContent='';render()
  if(changed)computeMoves()
}

function render(){
  if(!state){els.turn.textContent=role==='host'?'Waiting for player':'Joining…';return}
  const me=state.players.find(p=>p.id===myId)
  const myIndex=state.players.findIndex(p=>p.id===myId)
  const myTurn=state.status==='playing'&&state.turn===myIndex
  els.players.innerHTML=state.players.map((p,i)=>`
    <div class="player-card ${state.turn===i&&state.status==='playing'?'active':''}">
      <div><b>${escapeHtml(p.name)}${p.id===myId?' · you':''}</b><small>${p.rackCount} tiles</small></div>
      <strong>${p.score}</strong>
    </div>
  `).join('')
  els.bagCount.textContent=state.bagCount
  els.bagMeter.style.width=`${state.bagCount/86*100}%`
  els.turn.textContent=state.status==='finished'?finishText():myTurn?'Your turn':`${state.players[state.turn]?.name||'Opponent'}'s turn`
  els.turn.classList.toggle('mine',myTurn)
  els.pass.disabled=els.exchange.disabled=!myTurn
  els.play.disabled=!myTurn||!selected
  renderBoard();renderRack(me?.rack||[]);renderHistory();renderMoves()
  if(state.status==='finished'&&!document.body.dataset.finished){
    document.body.dataset.finished='1'
    setTimeout(showFinished,250)
  }
}
function finishText(){
  const a=state.players[0],b=state.players[1]
  if(a.score===b.score)return`Tie · ${a.score}`
  const w=a.score>b.score?a:b
  return`${w.name} wins · ${w.score}–${w===a?b.score:a.score}`
}
function renderBoard(){
  const preview=new Map((selected?.placements||[]).map(p=>[`${p.r},${p.c}`,p]))
  const last=new Set((state.lastPlay||[]).map(x=>x.join(',')))
  for(const cell of els.board.children){
    const r=+cell.dataset.r,c=+cell.dataset.c
    cell.innerHTML=''
    cell.classList.toggle('last-play',last.has(`${r},${c}`))
    const p=preview.get(`${r},${c}`),b=state.board[r][c]
    if(b)cell.append(tileEl(b.letter,b.blank))
    else if(p){const t=tileEl(p.letter,p.blank);t.classList.add('preview');cell.append(t)}
  }
}
function renderRack(rack){
  els.rack.innerHTML=''
  rack.forEach((l,i)=>{const t=tileEl(l==='?'?'':l,l==='?');t.dataset.i=i;els.rack.append(t)})
  els.rackHint.textContent=selected?`${selected.word} · ${selected.score}`:(state&&state.turn===state.players.findIndex(p=>p.id===myId)?'Choose a play':'')
}
function renderHistory(){
  const hs=state.history||[]
  if(!hs.length){els.history.innerHTML='';return}
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
  els.moves.innerHTML='<div class="moves-empty">Opening…<div class="loading-line"><i></i></div></div>'
  els.moveCount.textContent='…';els.summary.textContent=''
  await new Promise(r=>setTimeout(r,15))
  const found=generateMoves(state.board,mine.rack,lex)
  if(run!==computing)return
  moves=found;renderMoves()
}
function renderMoves(){
  if(!state)return
  const myIndex=state.players.findIndex(p=>p.id===myId),myTurn=state.status==='playing'&&state.turn===myIndex
  if(!myTurn){
    els.moveCount.textContent='—';els.summary.textContent='';els.moves.innerHTML='<div class="moves-empty">Waiting…</div>';return
  }
  const q=els.search.value.trim().toUpperCase(),sort=els.sort.value
  const groups=new Map()
  for(const m of moves){
    if(q&&!m.word.includes(q))continue
    if(!groups.has(m.word))groups.set(m.word,[])
    groups.get(m.word).push(m)
  }
  let list=[...groups.entries()].map(([word,placements])=>({word,placements,best:Math.max(...placements.map(m=>m.score))}))
  if(sort==='word')list.sort((a,b)=>a.word.localeCompare(b.word))
  else if(sort==='length')list.sort((a,b)=>b.word.length-a.word.length||b.best-a.best)
  else list.sort((a,b)=>b.best-a.best||a.word.localeCompare(b.word))
  const unique=new Set(moves.map(m=>m.word)).size
  els.moveCount.textContent=moves.length
  els.summary.textContent=`${unique} words · ${moves.length} moves`
  if(!list.length){
    els.moves.innerHTML=`<div class="moves-empty">${moves.length?'No matches':'No play'}</div>`;return
  }
  const shown=list.slice(0,visibleWords)
  els.moves.innerHTML=shown.map(g=>{
    const open=expandedWord===g.word
    const head=`<button class="move-row word-row ${open?'selected':''}" data-word="${g.word}"><div><div class="move-word">${g.word}</div><div class="move-meta">${g.placements.length} spot${g.placements.length===1?'':'s'}${g.word.length===7?' · 7':''}</div></div><div class="move-score">${g.best}</div></button>`
    if(!open)return head
    const placements=[...g.placements].sort((a,b)=>b.score-a.score||coord(a).localeCompare(coord(b)))
    return head+`<div class="placement-list">${placements.map(m=>`<button class="placement-row ${selected&&keyOfMove(selected)===keyOfMove(m)?'selected':''}" data-key="${encodeURIComponent(keyOfMove(m))}"><span>${coord(m)}${m.placements.length===7?' · BINGO':''}</span><b>${m.score}</b></button>`).join('')}</div>`
  }).join('')+(shown.length<list.length?`<button class="more-words" data-more>+${Math.min(250,list.length-shown.length)} more</button>`:'')
}
function coord(m){
  const p=m.placements.slice().sort((a,b)=>a.r-b.r||a.c-b.c)[0]
  return`${String.fromCharCode(65+p.c)}${p.r+1}${m.direction==='V'?' ↓':' →'}`
}
function chooseMove(m){
  selected=m;els.play.disabled=false;els.playScore.textContent=`+${m.score}`
  renderBoard();renderMoves();els.rackHint.textContent=`${m.word} · ${m.score}`
}

function openModal(html){els.modal.innerHTML=html;els.modalLayer.classList.remove('hidden')}
function closeModal(){els.modalLayer.classList.add('hidden')}
function showExchange(){
  const me=state.players.find(p=>p.id===myId)
  selectedExchange.clear()
  openModal(`<h2>Swap tiles</h2><div class="exchange-grid" id="exchangeGrid"></div><div class="modal-actions"><button class="ghost" data-close>Cancel</button><button class="primary" id="confirmExchange" disabled>Swap</button></div>`)
  const grid=$('#exchangeGrid')
  me.rack.forEach((l,i)=>{
    const t=tileEl(l==='?'?'':l,l==='?');t.dataset.i=i
    t.onclick=()=>{
      if(selectedExchange.has(i))selectedExchange.delete(i);else selectedExchange.add(i)
      t.classList.toggle('selected')
      $('#confirmExchange').disabled=!selectedExchange.size
    }
    grid.append(t)
  })
  $('#confirmExchange').onclick=()=>{const tiles=[...selectedExchange].map(i=>me.rack[i]);closeModal();act({type:'exchange',tiles})}
}
function showRules(){
  openModal(`<h2>Openbook Scrabble</h2><p>Standard Scrabble, except every legal play in your rack is shown.</p><ul class="rules-list"><li>Standard board, tiles, premiums and 50-point bingo.</li><li>The first word crosses the center.</li><li>Swap only while 7+ tiles remain.</li><li>Six scoreless turns ends the game.</li><li>Scores are shown; strategic advice is not.</li><li>Wordbook: ENABLE.</li></ul><div class="modal-actions"><button class="primary" data-close>Done</button></div>`)
}
function showFinished(){
  openModal(`<h2>${escapeHtml(finishText())}</h2><div class="modal-actions"><button class="ghost" data-close>Board</button><button class="primary" id="newGame">Home</button></div>`)
  $('#newGame').onclick=goHome
}

function create(){
  loadLexicon().then(()=>{
    const n=currentName()
    room=makeRoom();role='host';myId=uid();hostGame=null
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
    }
    persistIdentity();showGame();connectLobby()
    if(role==='host'){
      if(hostGame)setState(publicState(hostGame,myId))
      else{render();advertiseRoom()}
    }else{
      render();setTimeout(()=>send({t:'join',name:currentName(),id:myId}),250)
    }
  })
}
function parse(s){try{return JSON.parse(s)}catch{return null}}
function goHome(){
  if(isOpenHost())closeRoomListing(room)
  lobby?.close();lobby=null;state=null;hostGame=null;moves=[];selected=null;expandedWord='';els.playScore.textContent=''
  delete document.body.dataset.finished
  room='';role='';myId=''
  els.game.classList.add('hidden');els.landing.classList.remove('hidden')
  history.replaceState(null,'',location.pathname);closeModal();renderDirectory()
}

els.create.onclick=create
els.join.onclick=()=>join()
els.roomInput.onkeydown=e=>{if(e.key==='Enter')join()}
els.roomInput.oninput=()=>els.roomInput.value=els.roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g,'')
els.lobbyList.onclick=e=>{const row=e.target.closest('[data-room]');if(row)join(row.dataset.room)}
els.name.onchange=()=>{currentName();advertiseRoom()}
els.copy.onclick=()=>navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${room}`).then(()=>toast('Link copied'))
els.home.onclick=()=>{if(confirm('Leave game?'))goHome()}
els.pass.onclick=()=>openModal('<h2>Pass?</h2><div class="modal-actions"><button class="ghost" data-close>Cancel</button><button class="primary" id="confirmPass">Pass</button></div>')
els.exchange.onclick=()=>{if(state?.bagCount<7){toast('Not enough tiles');return}showExchange()}
els.play.onclick=()=>{if(selected)act({type:'play',placements:selected.placements})}
els.rules.onclick=showRules
els.modalLayer.onclick=e=>{if(e.target===els.modalLayer||e.target.closest('[data-close]'))closeModal()}
els.search.oninput=()=>{visibleWords=250;renderMoves()}
els.sort.onchange=()=>{visibleWords=250;renderMoves()}
els.moves.onclick=e=>{
  if(e.target.closest('[data-more]')){visibleWords+=250;renderMoves();return}
  const placement=e.target.closest('.placement-row')
  if(placement){
    const key=decodeURIComponent(placement.dataset.key),m=moves.find(x=>keyOfMove(x)===key)
    if(m)chooseMove(m)
    return
  }
  const row=e.target.closest('.word-row')
  if(!row)return
  expandedWord=expandedWord===row.dataset.word?'':row.dataset.word
  renderMoves()
  if(expandedWord){
    const options=moves.filter(m=>m.word===expandedWord).sort((a,b)=>b.score-a.score)
    if(options[0])chooseMove(options[0])
  }
}
document.addEventListener('click',e=>{if(e.target?.id==='confirmPass'){closeModal();act({type:'pass'})}})
window.addEventListener('beforeunload',()=>{persistHost();if(isOpenHost())closeRoomListing(room)})

buildDemo();buildBoard()
let initialName=localStorage.getItem('openbook-name')
if(!initialName){initialName=funnyName();saveName(initialName)}
els.name.value=initialName
connectDirectory()
const params=new URLSearchParams(location.search),invite=params.get('room')?.toUpperCase()
if(invite){els.roomInput.value=invite}
if('requestIdleCallback'in window)requestIdleCallback(()=>loadLexicon(true).catch(()=>{}))
else setTimeout(()=>loadLexicon(true).catch(()=>{}),800)
