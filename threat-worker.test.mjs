import assert from 'node:assert/strict'
import {emptyBoard,applyMove,removeRackTiles} from './game.js'
const messages=[]
globalThis.self={postMessage:data=>messages.push(structuredClone(data))}
await import('./threat-worker.js')
await self.onmessage({data:{type:'init',words:['AT','TA','CAT','ACT','TAC']}})
const board=emptyBoard()
// Your current rack is exact even though the unseen pool is large.
await self.onmessage({data:{id:1,board,pool:['C','A','T','?'],size:0,kept:['A','T']}})
assert.equal(messages.at(-1).exact,true)
assert.equal(messages.at(-1).result.samples,1)
assert.equal(messages.at(-1).result.any,1)
// Refills combine with the leave, without putting played tiles back in the pool.
const placements=[{r:7,c:7,letter:'A'},{r:7,c:8,letter:'T'}]
const kept=removeRackTiles(['A','T','C'],placements)
assert.deepEqual(kept,['C'])
const input={board:applyMove(board,placements),pool:['A','T','?'],size:1,kept}
await self.onmessage({data:{id:2,...input}})
const first=messages.at(-1)
assert.equal(first.exact,false)
assert.equal(first.result.samples,96)
assert.equal(first.result.hits[112],0)
assert.equal(first.result.hits[113],0)
await self.onmessage({data:{id:3,...input}})
assert.deepEqual(messages.at(-1).result,first.result)
// No draws in an empty bag: exact retained rack.
await self.onmessage({data:{id:4,...input,pool:['A'],size:0}})
assert.equal(messages.at(-1).exact,true)
// Cancellation suppresses stale results.
messages.length=0
const pending=self.onmessage({data:{id:5,...input}})
await self.onmessage({data:{type:'cancel'}})
await pending
assert.equal(messages.length,0)
// Both perspectives must finish independently on the same worker/request.
messages.length=0
await Promise.all([
  self.onmessage({data:{id:6,side:'you',...input}}),
  self.onmessage({data:{id:6,side:'opponent',...input,kept:[]}})
])
assert.deepEqual(messages.filter(m=>m.done).map(m=>m.side).sort(),['opponent','you'])
assert.ok(messages.every(m=>m.id===6))
messages.length=0
const both=[self.onmessage({data:{id:7,side:'you',...input}}),self.onmessage({data:{id:7,side:'opponent',...input}})]
await self.onmessage({data:{type:'cancel'}})
await Promise.all(both)
assert.equal(messages.length,0)
console.log('Threat worker tests passed')
