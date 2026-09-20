import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {emptyBoard,keyOfMove} from './game.js'

// Exercise the actual UI scheduler without a browser or expensive sampling.
const events=[]
const element=()=>({
  dataset:{},style:{removeProperty(){}},children:[],
  classList:{add(){},remove(){},toggle(){}},
  append(){},setAttribute(){},toggleAttribute(){},addEventListener(){},
  querySelectorAll(){return []},getContext(){return null}
})
const elements=new Map()
globalThis.document={
  querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector)},
  createElement:element,addEventListener(){},dispatchEvent(event){events.push(event)}
}
globalThis.CustomEvent=class {constructor(type,{detail}){this.type=type;this.detail=detail}}
const cores=Number(process.env.TEST_EV_CORES||4)
Object.defineProperty(globalThis,'navigator',{value:{hardwareConcurrency:cores},configurable:true})
const workers=[]
class FakeWorker{
  pending=[]
  constructor(){workers.push(this)}
  postMessage(data){
    if(data.type==='cancel')this.pending=[]
    else if(!data.type)this.pending.push(data)
  }
  terminate(){}
  ready(){this.onmessage({data:{type:'ready'}})}
  reply(job,extra={}){
    this.onmessage({data:{id:job.id,side:job.side,
      result:{samples:job.samples,bestTotal:job.samples*10,scores:Array(225).fill(0)},
      done:true,exact:false,...extra}})
  }
  finish(){
    const pair=this.pending.splice(0,2)
    assert.equal(pair.length,2)
    assert.equal(pair[0].id,pair[1].id)
    for(const job of pair){
      assert.ok((job.initialResult?.samples||0)<job.samples,'refinement resumes from a shallower seed')
      this.reply(job)
    }
    return pair[0]
  }
}
globalThis.Worker=FakeWorker
globalThis.window={Worker:FakeWorker}
const {initThreats,prefetchThreats,updateThreats,prioritizeThreats,releaseThreatPriority}=await import('./threat-ui.js')
const state={status:'playing',revision:1,board:emptyBoard(),bagCount:80,
  players:[{id:'me',rack:['A','T']},{id:'them',rackCount:7}]}
const moves=Array.from({length:14},(_,i)=>({score:30-i,placements:[{r:7,c:i,letter:'A',blank:false}]}))
const evs=()=>events.filter(e=>e.type==='openbook-move-ev').map(e=>e.detail)

// Queuing before initialization must also start automatically on readiness.
prefetchThreats(state,moves,'me')
initThreats(['AT'])
await Promise.resolve()
workers.forEach(w=>w.ready())
const [foreground,...background]=workers
const expectedWorkers=new Map([[1,1],[2,1],[4,2],[8,6],[16,8],[32,8]])
assert.equal(background.length,expectedWorkers.get(cores),'pool scales with logical cores and caps memory use')
assert.ok(background.every(w=>w.pending.length===2))

// No pointer/focus activity: all rough jobs run before deeper work is dispatched.
while(new Set(evs().map(e=>e.moveKey)).size<moves.length){
  const w=background.find(w=>w.pending[0]?.samples===1)
  assert.ok(w,'the queue must keep advancing after both sides finish')
  const first=w.pending.shift()
  w.reply(first)
  assert.equal(w.pending.length,1,'one side alone must not release the slot')
  w.reply(w.pending.shift())
}
assert.equal(evs().length,moves.length)
assert.ok(evs().every(e=>e.samples===1&&!e.done))
assert.ok(background.every(w=>w.pending[0]?.samples===4))

// A preview adopts its rough seed. The seed's stage-level done flag must not
// cause the foreground request to finish before BOTH new results arrive.
updateThreats(state,moves[0],'me')
assert.equal(foreground.pending.length,2)
assert.equal(foreground.pending[0].initialResult.samples,1)
foreground.finish()
assert.ok(evs().some(e=>e.moveKey===keyOfMove(moves[0])&&e.done))

let iterations=0
while(background.some(w=>w.pending.length)){
  assert.ok(++iterations<200,'refinement must terminate')
  background.find(w=>w.pending.length).finish()
}
const latest=new Map(evs().map(e=>[e.moveKey,e]))
assert.equal(latest.size,moves.length)
assert.ok([...latest.values()].every(e=>e.samples===96&&e.done),'all moves finish without hovering')
prefetchThreats(state,moves,'me')
assert.ok(workers.every(w=>!w.pending.length),'completed work is not restarted')

// Turn changes cancel outstanding work and ignore late replies.
const next={...state,revision:2}
prefetchThreats(next,moves,'me')
const stale=background[0].pending[0]
prefetchThreats({...state,revision:3},moves,'me')
const count=evs().length
background[0].reply(stale)
assert.equal(evs().length,count)

// Errors release a slot rather than stalling or retrying forever.
const failed=background[0].pending.splice(0,2)
for(const job of failed)background[0].reply(job,{result:undefined,error:'Failed'})
iterations=0
while(background.some(w=>w.pending.length)){
  assert.ok(++iterations<200)
  background.find(w=>w.pending.length).finish()
}
// Off-screen rows stop immediately; stale completions cannot restart them.
const scrollingState={...state,revision:4}
prefetchThreats(scrollingState,moves,'me')
background[0].finish()
const offscreen=background.flatMap(w=>w.pending.map(job=>({w,job})))
prefetchThreats(scrollingState,[moves[0]],'me')
assert.equal(background.filter(w=>w.pending.length).length,1)
const resumed=background.find(w=>w.pending.length)
assert.equal(resumed.pending[0].samples,4)
assert.equal(resumed.pending[0].initialResult.samples,1,'retain cached samples when scrolling')
const beforeStale=evs().length
for(const {w,job} of offscreen)w.reply(job)
assert.equal(evs().length,beforeStale,'ignore results from canceled off-screen jobs')
prefetchThreats(scrollingState,[],'me')
assert.ok(background.every(w=>!w.pending.length),'an empty viewport cancels all background work')
prefetchThreats(scrollingState,[moves[0]],'me')
assert.equal(background.find(w=>w.pending.length).pending[0].initialResult.samples,1)
iterations=0
while(background.some(w=>w.pending.length)){
  assert.ok(++iterations<10,'only the visible move should be refined')
  background.find(w=>w.pending.length).finish()
}
assert.equal(evs().filter(e=>e.revision===4&&e.done).length,1)
// Rapid hovering must preempt, not multiplex all old previews on one worker.
const hoverState={...state,revision:5}
prefetchThreats(hoverState,moves.slice(0,2),'me')
updateThreats(hoverState,moves[0],'me')
const firstHover=foreground.pending.splice(0,2)
assert.ok(firstHover.every(job=>job.samples===96))
for(const job of firstHover)foreground.reply(job,{
  result:{samples:8,bestTotal:80,scores:Array(225).fill(0)},done:false
})
updateThreats(hoverState,moves[1],'me')
assert.equal(foreground.pending.length,2,'only the current hover owns the foreground worker')
const beforeOldHover=evs().length
for(const job of firstHover)foreground.reply(job)
assert.equal(evs().length,beforeOldHover,'canceled hover results cannot overwrite cached partials')
releaseThreatPriority()
assert.equal(foreground.pending.length,0,'leaving relinquishes foreground priority')
assert.ok(background.some(w=>w.pending.length),'visible moves resume normal refinement')
prioritizeThreats()
assert.equal(foreground.pending.length,2,'re-entering the same preview restores priority')
assert.ok(foreground.pending.every(job=>job.samples===96))
foreground.finish()
iterations=0
while(background.some(w=>w.pending.length)){
  assert.ok(++iterations<20)
  background.find(w=>w.pending.length).finish()
}
assert.equal(new Set(evs().filter(e=>e.revision===5&&e.done).map(e=>e.moveKey)).size,2)
console.log(`Threat UI scheduler tests passed (${cores} logical cores)`)
if(!process.env.TEST_EV_CORES){
  for(const cores of [1,2,8,16,32]){
    const run=spawnSync(process.execPath,[import.meta.filename],{
      env:{...process.env,TEST_EV_CORES:String(cores)},encoding:'utf8'
    })
    assert.equal(run.status,0,run.stdout+run.stderr)
    process.stdout.write(run.stdout)
  }
}
