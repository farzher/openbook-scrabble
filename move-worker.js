import {Lexicon,generateMoves} from './game.js'

let lexicon
self.onmessage=({data})=>{
  try{
    if(data.type==='init'){lexicon=new Lexicon(data.words);return}
    self.postMessage({id:data.id,moves:generateMoves(data.board,data.rack,lexicon)})
  }catch(error){self.postMessage({id:data.id,error:error.message})}
}
