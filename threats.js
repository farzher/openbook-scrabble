import {SIZE, DISTRIBUTION, generateMoves} from './game.js'

export function unseenPool(board,rack){
  const counts={...DISTRIBUTION}
  // Assigned blanks are still physical blanks, not the letter they represent.
  for(const row of board)for(const tile of row)if(tile)counts[tile.blank?'?':tile.letter]--
  for(const tile of rack)counts[tile]--
  return Object.entries(counts).flatMap(([letter,n])=>Array(Math.max(0,n)).fill(letter))
}

// Sample physical tiles without replacement, not letters with equal probability.
export function sampleRack(pool, size, random=Math.random){
  if(!Number.isInteger(size)||size<0||size>pool.length)throw new RangeError('Invalid rack sample size')
  const tiles=[...pool]
  for(let i=0;i<size;i++){
    const j=i+Math.floor(random()*(tiles.length-i))
    ;[tiles[i],tiles[j]]=[tiles[j],tiles[i]]
  }
  return tiles.slice(0,size)
}
export function createThreats(){
  return {samples:0,hits:Array(SIZE*SIZE).fill(0),scores:Array(SIZE*SIZE).fill(0),topScores:Array(SIZE*SIZE).fill(0),topHits:Array(SIZE*SIZE).fill(0),examples:Array(SIZE*SIZE).fill(null),any:0,bestTotal:0}
}
// Per square, one rack contributes its best complete move score (not a
// sum of alternatives). Racks with no move contribute zero to the EV.
// Scores come from the shared legal-move engine, including blank flags.
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
  for(const [index,score] of touched){
    result.hits[index]++
    result.scores[index]+=score
    if(score>result.topScores[index]){
      result.topScores[index]=score
      result.topHits[index]=1
    }else if(score===result.topScores[index]){
      result.topHits[index]++
    }
  }
  result.bestTotal+=best
  if(touched.size)result.any++
  result.samples++
  return result
}
export function sampleThreats(board,pool,size,lex,result,random=Math.random){
  return addThreatSample(result,generateMoves(board,sampleRack(pool,size,random),lex))
}
