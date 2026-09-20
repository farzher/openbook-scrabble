import {SIZE, generateMoves} from './game.js'

// Sample physical tiles without replacement, not letters with equal probability.
export function sampleRack(pool, size, random=Math.random){
  const tiles=[...pool]
  for(let i=0;i<size;i++){
    const j=i+Math.floor(random()*(tiles.length-i))
    ;[tiles[i],tiles[j]]=[tiles[j],tiles[i]]
  }
  return tiles.slice(0,size)
}
export function createThreats(){
  return {samples:0,hits:Array(SIZE*SIZE).fill(0),scores:Array(SIZE*SIZE).fill(0),examples:Array(SIZE*SIZE).fill(null),any:0,bestTotal:0}
}
export function addThreatSample(result, moves){
  const touched=new Map()
  let best=0
  for(const move of moves){
    best=Math.max(best,move.score)
    for(const p of move.placements){
      const index=p.r*SIZE+p.c
      touched.set(index,Math.max(touched.get(index)||0,move.score))
      if(!result.examples[index]||move.score>result.examples[index].score)result.examples[index]=move
    }
  }
  // Several qualifying words on the same rack count as ONE opportunity.
  for(const [index,score] of touched){result.hits[index]++;result.scores[index]+=score}
  result.bestTotal+=best
  if(touched.size)result.any++
  result.samples++
  return result
}
export function sampleThreats(board,pool,size,lex,result,random=Math.random){
  return addThreatSample(result,generateMoves(board,sampleRack(pool,size,random),lex))
}
