export const SIZE = 15
export const CENTER = 7
export const LETTER_SCORES = Object.freeze({A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10,'?':0})
export const DISTRIBUTION = Object.freeze({A:9,B:2,C:2,D:4,E:12,F:2,G:3,H:2,I:9,J:1,K:1,L:4,M:2,N:6,O:8,P:2,Q:1,R:6,S:4,T:6,U:4,V:2,W:2,X:1,Y:2,Z:1,'?':2})

const triplesWord = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]]
const doublesWord = [[1,1],[2,2],[3,3],[4,4],[7,7],[10,10],[11,11],[12,12],[13,13],[1,13],[2,12],[3,11],[4,10],[10,4],[11,3],[12,2],[13,1]]
const triplesLetter = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]]
const doublesLetter = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]]

export const PREMIUM = Array.from({length:SIZE},()=>Array(SIZE).fill(''))
for(const [r,c] of triplesWord) PREMIUM[r][c]='tw'
for(const [r,c] of doublesWord) PREMIUM[r][c]='dw'
for(const [r,c] of triplesLetter) PREMIUM[r][c]='tl'
for(const [r,c] of doublesLetter) PREMIUM[r][c]='dl'

export function emptyBoard(){ return Array.from({length:SIZE},()=>Array(SIZE).fill(null)) }
export function makeBag(){
  const bag=[]
  for(const [letter,count] of Object.entries(DISTRIBUTION)) for(let i=0;i<count;i++) bag.push(letter)
  shuffle(bag); return bag
}
export function shuffle(a){
  const buf = new Uint32Array(a.length); crypto.getRandomValues(buf)
  for(let i=a.length-1;i>0;i--){ const j=buf[i]%(i+1); [a[i],a[j]]=[a[j],a[i]] }
  return a
}
export function draw(bag,n){ return bag.splice(Math.max(0,bag.length-n),n) }
export function rackValue(rack){ return rack.reduce((s,l)=>s+(LETTER_SCORES[l]||0),0) }
export function boardHasTiles(board){ return board.some(row=>row.some(Boolean)) }
export function keyOfMove(m){ return m.placements.map(p=>`${p.r},${p.c},${p.letter},${p.blank?1:0}`).sort().join('|') }

export class Lexicon {
  constructor(words){
    this.words = new Set()
    this.nodes = [{next:Object.create(null), end:false}]
    for(const raw of words){
      const word=raw.trim().toUpperCase()
      if(word.length<2 || word.length>15 || !/^[A-Z]+$/.test(word) || this.words.has(word)) continue
      this.words.add(word)
      let node=0
      for(const ch of word){
        let nx=this.nodes[node].next[ch]
        if(nx===undefined){ nx=this.nodes.length; this.nodes[node].next[ch]=nx; this.nodes.push({next:Object.create(null),end:false}) }
        node=nx
      }
      this.nodes[node].end=true
    }
  }
  has(word){ return this.words.has(word.toUpperCase()) }
}

function inside(r,c){ return r>=0&&r<SIZE&&c>=0&&c<SIZE }
function at(board,r,c){ return inside(r,c)?board[r][c]:null }
function letterScore(cell){ return cell.blank?0:LETTER_SCORES[cell.letter] }

function crossData(board,lex,r,c,dr,dc){
  // Use normal reading order for the perpendicular word: top→bottom or left→right.
  const pr=dr===0?1:0, pc=dr===0?0:1
  let prefix=''; let rr=r-pr, cc=c-pc
  while(inside(rr,cc)&&board[rr][cc]){ prefix=board[rr][cc].letter+prefix; rr-=pr; cc-=pc }
  let suffix=''; rr=r+pr; cc=c+pc
  while(inside(rr,cc)&&board[rr][cc]){ suffix+=board[rr][cc].letter; rr+=pr; cc+=pc }
  if(!prefix && !suffix) return {mask:null,prefix,suffix}
  const allowed=new Set()
  for(let n=65;n<=90;n++){ const ch=String.fromCharCode(n); if(lex.has(prefix+ch+suffix)) allowed.add(ch) }
  return {mask:allowed,prefix,suffix}
}

function scoreWord(board, placementsMap, startR,startC,dr,dc){
  let sum=0, wordMult=1, word=''; let r=startR,c=startC
  while(inside(r,c)){
    const p=placementsMap.get(`${r},${c}`); const existing=board[r][c]
    if(!p&&!existing) break
    const cell=p||existing; word+=cell.letter
    let value=p?(p.blank?0:LETTER_SCORES[p.letter]):letterScore(existing)
    if(p){ const prem=PREMIUM[r][c]; if(prem==='dl') value*=2; if(prem==='tl') value*=3; if(prem==='dw') wordMult*=2; if(prem==='tw') wordMult*=3 }
    sum+=value; r+=dr;c+=dc
  }
  return {word,score:sum*wordMult}
}

export function evaluatePlacements(board, placements, lex){
  if(!placements?.length) return {ok:false,error:'Place at least one tile.'}
  const map=new Map();
  for(const p of placements){
    if(!inside(p.r,p.c)||board[p.r][p.c]) return {ok:false,error:'That square is occupied.'}
    const k=`${p.r},${p.c}`; if(map.has(k)) return {ok:false,error:'Duplicate square.'}
    map.set(k,p)
  }
  const sameRow=placements.every(p=>p.r===placements[0].r), sameCol=placements.every(p=>p.c===placements[0].c)
  if(!sameRow&&!sameCol) return {ok:false,error:'Tiles must be in one row or column.'}
  let dr= sameCol?1:0, dc=sameCol?0:1
  if(placements.length===1){
    const p=placements[0]
    const h=!!at(board,p.r,p.c-1)||!!at(board,p.r,p.c+1), v=!!at(board,p.r-1,p.c)||!!at(board,p.r+1,p.c)
    if(v&&!h){dr=1;dc=0}
  }
  let min=Infinity,max=-Infinity
  for(const p of placements){ const q=dr?p.r:p.c; min=Math.min(min,q);max=Math.max(max,q) }
  // Expand over existing tiles then ensure no internal gaps.
  let fixed=dr?placements[0].c:placements[0].r
  let start=min
  while(start>0 && (dr?board[start-1][fixed]:board[fixed][start-1])) start--
  let end=max
  while(end<SIZE-1 && (dr?board[end+1][fixed]:board[fixed][end+1])) end++
  for(let q=start;q<=end;q++){
    const r=dr?q:fixed,c=dr?fixed:q
    if(!board[r][c]&&!map.has(`${r},${c}`)) return {ok:false,error:'Words cannot contain gaps.'}
  }
  const startR=dr?start:fixed,startC=dr?fixed:start
  const main=scoreWord(board,map,startR,startC,dr,dc)
  if(main.word.length<2) return {ok:false,error:'A play must make a word of at least two letters.'}
  const hadTiles=boardHasTiles(board)
  let connected=!hadTiles
  if(!hadTiles && !map.has(`${CENTER},${CENTER}`)) return {ok:false,error:'The first word must cover the center star.'}
  const words=[main]; let score=main.score
  for(const p of placements){
    for(const [ar,ac] of [[-1,0],[1,0],[0,-1],[0,1]]) if(at(board,p.r+ar,p.c+ac)) connected=true
    const cr=dr===0?1:0,cc=dr===0?0:1
    let sr=p.r,sc=p.c
    while(at(board,sr-cr,sc-cc)){sr-=cr;sc-=cc}
    const cross=scoreWord(board,map,sr,sc,cr,cc)
    if(cross.word.length>1){ words.push(cross);score+=cross.score; connected=true }
  }
  // Main word itself may include existing tiles.
  for(let q=start;q<=end;q++){const r=dr?q:fixed,c=dr?fixed:q;if(board[r][c])connected=true}
  if(hadTiles&&!connected) return {ok:false,error:'The play must connect to the board.'}
  for(const w of words) if(!lex.has(w.word)) return {ok:false,error:`${w.word} is not in this wordbook.`}
  if(placements.length===7) score+=50
  return {ok:true,score,words,direction:dr?'V':'H',word:main.word}
}

function canReachConnection(board,startR,startC,dr,dc){
  let empty=0,r=startR,c=startC
  while(inside(r,c)){
    if(board[r][c]) return empty<=7
    const pr=-dc,pc=dr
    if(at(board,r-pr,c-pc)||at(board,r+pr,c+pc)) return empty<7
    empty++; if(empty>7) return false
    r+=dr;c+=dc
  }
  return false
}

export function generateMoves(board,rack,lex){
  if(!lex||!rack?.length) return []
  const results=new Map(), first=!boardHasTiles(board)
  const counts=Object.create(null); let blanks=0
  for(const t of rack){ if(t==='?') blanks++; else counts[t]=(counts[t]||0)+1 }
  const crossCache=new Map()
  const getCross=(r,c,dr,dc)=>{ const k=`${r},${c},${dr}`; if(!crossCache.has(k)) crossCache.set(k,crossData(board,lex,r,c,dr,dc)); return crossCache.get(k) }

  for(const [dr,dc] of [[0,1],[1,0]]){
    for(let sr=0;sr<SIZE;sr++) for(let sc=0;sc<SIZE;sc++){
      const br=sr-dr,bc=sc-dc
      if(inside(br,bc)&&board[br][bc]) continue // must start at beginning of main word
      if(first){
        if((dr===0&&sr!==CENTER)||(dr===1&&sc!==CENTER)) continue
        const dist=dr?CENTER-sr:CENTER-sc
        if(dist<0||dist>6) continue
      } else if(!canReachConnection(board,sr,sc,dr,dc)) continue

      const placed=[]
      const accept=()=>{
        const ev=evaluatePlacements(board,placed,lex)
        if(!ev.ok) return
        const move={placements:placed.map(p=>({...p})),score:ev.score,word:ev.word,words:ev.words,direction:ev.direction}
        const key=keyOfMove(move); const old=results.get(key)
        if(!old||move.score>old.score) results.set(key,move)
      }
      const walk=(r,c,node,used,connected)=>{
        if(!inside(r,c)){
          if(lex.nodes[node].end&&used>0&&connected&&placed.length) accept()
          return
        }
        const existing=board[r][c]
        if(existing){
          const nx=lex.nodes[node].next[existing.letter]
          if(nx!==undefined) walk(r+dr,c+dc,nx,used,true)
          return
        }
        if(lex.nodes[node].end&&used>0&&connected&&placed.length) accept()
        if(used>=7) return
        const cross=getCross(r,c,dr,dc), hereConnect=!!cross.prefix||!!cross.suffix||(!first&&connected)
        for(const [ch,nx] of Object.entries(lex.nodes[node].next)){
          if(cross.mask&&!cross.mask.has(ch)) continue
          if((counts[ch]||0)>0){
            counts[ch]--; placed.push({r,c,letter:ch,blank:false})
            const centerConnect=first&&r===CENTER&&c===CENTER
            walk(r+dr,c+dc,nx,used+1,connected||hereConnect||centerConnect)
            placed.pop(); counts[ch]++
          }
          if(blanks>0){
            blanks--; placed.push({r,c,letter:ch,blank:true})
            const centerConnect=first&&r===CENTER&&c===CENTER
            walk(r+dr,c+dc,nx,used+1,connected||hereConnect||centerConnect)
            placed.pop(); blanks++
          }
        }
      }
      walk(sr,sc,0,0,false)
    }
  }
  return [...results.values()].sort((a,b)=>b.score-a.score||b.word.length-a.word.length||a.word.localeCompare(b.word))
}

export function validateRackUse(rack,placements){
  const counts=Object.create(null); for(const t of rack) counts[t]=(counts[t]||0)+1
  for(const p of placements){ const t=p.blank?'?':p.letter; if(!counts[t]) return false; counts[t]-- }
  return true
}
export function removeRackTiles(rack,placements){
  const out=[...rack]
  for(const p of placements){ const t=p.blank?'?':p.letter; const i=out.indexOf(t); if(i<0) throw new Error('Rack mismatch'); out.splice(i,1) }
  return out
}
export function applyMove(board,placements){
  const next=board.map(row=>row.map(cell=>cell?{...cell}:null))
  for(const p of placements) next[p.r][p.c]={letter:p.letter,blank:!!p.blank}
  return next
}

export const DEFAULT_TIMER = Object.freeze({mode:'farzher',initialMs:5*60_000,ettRate:.10})

export function normalizeTimerConfig(config={}){
  const mode=['standard','farzher','off'].includes(config.mode)?config.mode:'standard'
  const fallback=mode==='farzher'?5*60_000:25*60_000
  const initialMs=Math.max(30_000,Math.min(60*60_000,Number(config.initialMs)||fallback))
  const ettRate=Math.max(.01,Math.min(.5,Number(config.ettRate)||.10))
  return {mode,initialMs,ettRate}
}
function createTimer(config){
  const c=normalizeTimerConfig(config)
  if(c.mode==='off') return {mode:'off'}
  return {mode:c.mode,initialMs:c.initialMs,ettRate:c.ettRate,clocks:[c.initialMs,c.initialMs],turnStartedAt:Date.now(),last:null}
}
function rawTurnElapsed(game,now=Date.now()){
  return game.timer&&game.timer.mode!=='off'&&game.status==='playing'?Math.max(0,now-game.timer.turnStartedAt):0
}
export function timerSnapshot(game,now=Date.now()){
  const t=game.timer
  if(!t||t.mode==='off') return t?{mode:'off'}:null
  const clocks=[...t.clocks],elapsed=rawTurnElapsed(game,now)
  if(game.status==='playing'&&elapsed){
    clocks[game.turn]-=elapsed
    if(t.mode==='farzher') for(let i=0;i<clocks.length;i++) if(i!==game.turn) clocks[i]+=elapsed
  }
  const pool=t.mode==='farzher'?t.clocks.reduce((a,b)=>a+b,0):null
  return {
    mode:t.mode,initialMs:t.initialMs,ettRate:t.ettRate,clocks,
    active:game.status==='playing'?game.turn:-1,
    ettMs:pool===null?null:Math.max(0,pool*t.ettRate),
    last:t.last
  }
}
function finishOnTime(game,loser){
  game.status='finished'
  game.winner=1-loser
  game.history.push({type:'end',reason:'time',loser})
}
export function checkStandardTimeout(game,now=Date.now()){
  const t=game.timer
  if(!t||t.mode!=='standard'||game.status!=='playing') return false
  const elapsed=rawTurnElapsed(game,now),active=game.turn
  if(elapsed<t.clocks[active]) return false
  t.clocks[active]=0
  t.turnStartedAt=now
  t.last={player:active,elapsedMs:elapsed}
  game.revision++
  finishOnTime(game,active)
  return true
}
function settleTimerTurn(game,playerIndex,now=Date.now()){
  const t=game.timer
  if(!t||t.mode==='off') return {ok:true}
  const elapsed=Math.max(0,now-t.turnStartedAt)
  if(t.mode==='standard'){
    if(elapsed>=t.clocks[playerIndex]){
      t.clocks[playerIndex]=0
      t.turnStartedAt=now
      t.last={player:playerIndex,elapsedMs:elapsed}
      finishOnTime(game,playerIndex)
      return {ok:false,error:'Time expired.',timedOut:true}
    }
    t.clocks[playerIndex]-=elapsed
    t.last={player:playerIndex,elapsedMs:elapsed}
    t.turnStartedAt=now
    return {ok:true}
  }

  // Farzher Timer:
  // 1) transfer spent time to every opponent
  // 2) ETT is a percentage of the turn-start pool
  // 3) add (spent - ETT) to every clock
  const pool=t.clocks.reduce((a,b)=>a+b,0)
  const ett=Math.max(0,pool*t.ettRate)
  t.clocks[playerIndex]-=elapsed
  for(let i=0;i<t.clocks.length;i++) if(i!==playerIndex)t.clocks[i]+=elapsed
  const adjustment=elapsed-ett
  for(let i=0;i<t.clocks.length;i++) t.clocks[i]+=adjustment
  t.last={player:playerIndex,elapsedMs:elapsed,ettMs:ett,adjustmentMs:adjustment}
  t.turnStartedAt=now
  if(t.clocks[playerIndex]<=0){
    t.clocks[playerIndex]=0
    finishOnTime(game,playerIndex)
    return {ok:false,error:'Time expired.',timedOut:true}
  }
  return {ok:true}
}

export function createGame(hostId,hostName,guestId,guestName,{timer=DEFAULT_TIMER}={}){
  const bag=makeBag(), players=[
    {id:hostId,name:hostName||'Host',score:0,rack:draw(bag,7)},
    {id:guestId,name:guestName||'Guest',score:0,rack:draw(bag,7)}
  ]
  return {version:1,revision:1,status:'playing',board:emptyBoard(),bag,players,turn:0,history:[],scoreless:0,lastPlay:[],timer:createTimer(timer)}
}

export function publicState(game,viewerId){
  return {
    version:game.version,revision:game.revision,status:game.status,board:game.board,
    bagCount:game.bag.length,turn:game.turn,history:game.history,lastPlay:game.lastPlay,scoreless:game.scoreless,timer:timerSnapshot(game),
    players:game.players.map(p=>({id:p.id,name:p.name,score:p.score,rackCount:p.rack.length,rack:p.id===viewerId?p.rack:undefined})),
    you:viewerId
  }
}

export function processAction(game,playerId,action,lex){
  if(game.status!=='playing') return {ok:false,error:'This game is over.'}
  const pi=game.players.findIndex(p=>p.id===playerId)
  if(pi<0||pi!==game.turn) return {ok:false,error:'It is not your turn.'}
  if(action.revision!==game.revision) return {ok:false,error:'Your board was out of date. Synced to the latest turn.'}
  const player=game.players[pi]

  // Validate the action before charging the turn where possible.
  if(action.type==='play'){
    if(!validateRackUse(player.rack,action.placements)) return {ok:false,error:'Those tiles are not in your rack.'}
    const ev=evaluatePlacements(game.board,action.placements,lex); if(!ev.ok) return ev
    const timed=settleTimerTurn(game,pi)
    if(!timed.ok){ game.revision++; return {...timed,changed:true} }

    game.board=applyMove(game.board,action.placements); player.rack=removeRackTiles(player.rack,action.placements)
    player.score+=ev.score; player.rack.push(...draw(game.bag,7-player.rack.length)); game.scoreless=ev.score?0:game.scoreless+1
    game.lastPlay=action.placements.map(p=>[p.r,p.c])
    game.history.push({player:pi,type:'play',word:ev.word,words:ev.words.map(w=>w.word),score:ev.score,tiles:action.placements.length})
  } else if(action.type==='pass'){
    const timed=settleTimerTurn(game,pi)
    if(!timed.ok){ game.revision++; return {...timed,changed:true} }
    game.scoreless++; game.lastPlay=[]; game.history.push({player:pi,type:'pass',score:0})
  } else if(action.type==='exchange'){
    const tiles=Array.isArray(action.tiles)?action.tiles:[]
    if(!tiles.length) return {ok:false,error:'Choose at least one tile to exchange.'}
    if(game.bag.length<7) return {ok:false,error:'You can only exchange while at least 7 tiles remain in the bag.'}
    const temp=[...player.rack]
    for(const t of tiles){const i=temp.indexOf(t);if(i<0)return {ok:false,error:'Those tiles are not in your rack.'};temp.splice(i,1)}
    const timed=settleTimerTurn(game,pi)
    if(!timed.ok){ game.revision++; return {...timed,changed:true} }
    const fresh=draw(game.bag,tiles.length); game.bag.push(...tiles);shuffle(game.bag);player.rack=temp.concat(fresh)
    game.scoreless++;game.lastPlay=[];game.history.push({player:pi,type:'exchange',count:tiles.length,score:0})
  } else return {ok:false,error:'Unknown action.'}

  game.revision++
  const wentOut=game.bag.length===0&&player.rack.length===0
  if(wentOut){
    const other=game.players[1-pi],penalty=rackValue(other.rack); other.score-=penalty;player.score+=penalty
    game.status='finished';game.winner=player.score===other.score?-1:(player.score>other.score?pi:1-pi);game.history.push({type:'end',reason:'out',penalty})
  } else if(game.scoreless>=6 && game.players.some(p=>p.score>0)){
    for(const p of game.players) p.score-=rackValue(p.rack)
    game.status='finished';game.winner=game.players[0].score===game.players[1].score?-1:(game.players[0].score>game.players[1].score?0:1);game.history.push({type:'end',reason:'six-zero'})
  } else game.turn=1-game.turn
  return {ok:true}
}
