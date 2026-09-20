import assert from 'node:assert/strict'
import {emptyBoard,Lexicon,evaluatePlacements,generateMoves,applyMove,removeRackTiles,validateRackUse} from './game.js'
import {sampleRack,createThreats,addThreatSample,unseenPool} from './threats.js'

// A blank scores zero in BOTH words; word premiums still apply to both.
const cross=emptyBoard()
cross[1][0]={letter:'C'};cross[1][2]={letter:'T'}
cross[0][1]={letter:'A'};cross[2][1]={letter:'T'}
const lex=new Lexicon(['CAT','AAT'])
const blank=[{r:1,c:1,letter:'A',blank:true}]
assert.equal(evaluatePlacements(cross,blank,lex).score,12)
const generated=generateMoves(cross,['?'],lex).find(m=>m.placements.some(p=>p.r===1&&p.c===1))
assert.equal(generated.score,12)
assert.equal(generated.placements[0].blank,true)
assert.equal(validateRackUse(['?'],generated.placements),true)
assert.deepEqual(removeRackTiles(['?','A'],blank),['A'])
const applied=applyMove(cross,blank)
assert.deepEqual(applied[1][1],{letter:'A',blank:true})
assert.equal(cross[1][1],null)

// Letter multipliers cannot give a blank points.
const triple=emptyBoard();triple[1][4]={letter:'C'};triple[1][6]={letter:'T'}
assert.equal(evaluatePlacements(triple,[{r:1,c:5,letter:'A',blank:true}],lex).score,4)

// Existing blanks stay zero and old word premiums are not reused.
const old=applyMove(emptyBoard(),[{r:7,c:7,letter:'A',blank:true},{r:7,c:8,letter:'T'}])
assert.equal(evaluatePlacements(old,[{r:7,c:9,letter:'S'}],new Lexicon(['ATS'])).score,2)

// Two blanks still count as tiles toward the 50-point bingo bonus.
const bingo=Array.from({length:7},(_,i)=>({r:7,c:4+i,letter:'A',blank:i<2}))
assert.equal(evaluatePlacements(emptyBoard(),bingo,new Lexicon(['AAAAAAA'])).score,60)

// Exhaust all physical one-tile draws: repeated letters retain their weight,
// an unusable rack contributes zero, and a blank contributes only one point.
const board=emptyBoard();board[7][7]={letter:'A'}
const result=createThreats(),words=new Lexicon(['AT'])
for(const tile of ['T','T','?','Z'])addThreatSample(result,generateMoves(board,[tile],words))
assert.equal(result.samples,4)
assert.equal(result.hits[113],3)
assert.equal(result.scores[113]/result.samples,1.25)
assert.equal(result.topScores[113],2)
assert.equal(result.topHits[113],2)

// A legal all-blank word is playable even though its score/EV is zero.
const zero=createThreats()
addThreatSample(zero,generateMoves(emptyBoard(),['?','?'],words))
assert.equal(zero.hits[112],1)
assert.equal(zero.scores[112],0)
assert.ok(zero.examples[112].placements.every(p=>p.blank))

for(const n of [-1,1.5,5,NaN])assert.throws(()=>sampleRack(['?','A'],n),RangeError)
assert.deepEqual(sampleRack(['?','A'],2,()=>0),['?','A'])
// Public tile accounting removes an assigned blank as '?', not as 'A'.
const pool=unseenPool(old,['?','A'])
assert.equal(pool.length,96)
assert.equal(pool.filter(t=>t==='?').length,0)
assert.equal(pool.filter(t=>t==='A').length,8)
assert.equal(pool.filter(t=>t==='T').length,5)
// Moving a blank from rack to board does not reintroduce it into the pool.
const before=emptyBoard(),rack=['?','A','T']
const placement=[{r:7,c:7,letter:'Z',blank:true}]
assert.deepEqual(unseenPool(before,rack),unseenPool(applyMove(before,placement),removeRackTiles(rack,placement)))
console.log('Blank scoring and expected-value regression tests passed')
