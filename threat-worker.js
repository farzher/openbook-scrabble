import {Lexicon,generateMoves} from './game.js'
import {createThreats,sampleRack,addThreatSample} from './threats.js'

let lex,run=0

function sampleRandom(pool,index){
  let seed=2166136261
  for(const tile of pool)seed=Math.imul(seed^tile.charCodeAt(0),16777619)>>>0
  seed=(seed^Math.imul(index+1,0x9e3779b1))>>>0
  return ()=>{
    seed=(seed+0x6D2B79F5)|0
    let t=seed
    t=Math.imul(t^(t>>>15),t|1)
    t^=t+Math.imul(t^(t>>>7),t|61)
    return ((t^(t>>>14))>>>0)/4294967296
  }
}

self.onmessage=async({data})=>{
  if(data.type==='init'||data.type==='cancel')run++
  const token=run
  try{
    if(data.type==='init'){lex=new Lexicon(data.words);self.postMessage({type:'ready'});return}
    if(data.type==='cancel')return

    const {id,board,pool,size,kept=[]}=data
    const requested=Math.max(1,Math.min(96,Number(data.samples)||96))
    const exact=size===0||size===pool.length
    const total=exact?1:requested
    const reportEvery=Math.max(1,Number(data.reportEvery)||8)
    const result=data.initialResult?.samples?data.initialResult:createThreats()

    if(!lex||!Number.isInteger(size)||size<0||size>pool.length||kept.length+size>7)throw Error('Invalid threat input')

    const start=Math.min(result.samples||0,total)
    if(start>=total){
      self.postMessage({id,side:data.side,result,done:true,exact})
      return
    }

    for(let i=start;i<total;i++){
      if(token!==run)return
      addThreatSample(result,generateMoves(board,[...kept,...sampleRack(pool,size,sampleRandom(pool,i))],lex))
      if((i+1)%reportEvery===0||i===total-1)self.postMessage({id,side:data.side,result,done:i===total-1,exact})
      await new Promise(resolve=>setTimeout(resolve,0))
    }
  }catch(error){
    self.postMessage({id:data.id,side:data.side,error:error.message})
  }
}
