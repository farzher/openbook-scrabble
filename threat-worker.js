import {Lexicon,generateMoves} from './game.js'
import {createThreats,sampleRack,addThreatSample} from './threats.js'
let lex,run=0
self.onmessage=async({data})=>{
  if(data.type==='init'||data.type==='cancel')run++
  const token=run
  try{
    if(data.type==='init'){lex=new Lexicon(data.words);return}
    if(data.type==='cancel')return
    const {id,board,pool,size,kept=[]}=data
    const result=createThreats(),total=size===0||size===pool.length?1:96,reportEvery=Math.max(1,Number(data.reportEvery)||8)
    // Reuse the same sampled racks across previews to avoid comparison noise.
    let seed=2166136261
    for(const tile of pool)seed=Math.imul(seed^tile.charCodeAt(0),16777619)>>>0
    const random=()=>{seed=(seed+0x6D2B79F5)|0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}
    if(!lex||!Number.isInteger(size)||size<0||size>pool.length||kept.length+size>7)throw Error('Invalid threat input')
    for(let i=0;i<total;i++){
      if(token!==run)return
      addThreatSample(result,generateMoves(board,[...kept,...sampleRack(pool,size,random)],lex))
      if((i+1)%reportEvery===0||i===total-1)self.postMessage({id,side:data.side,result,done:i===total-1,exact:total===1})
      // Let new previews cancel old work between racks.
      await new Promise(resolve=>setTimeout(resolve,0))
    }
  }catch(error){self.postMessage({id:data.id,side:data.side,error:error.message})}
}
