// Quiet, synthesized feedback. No downloads; audio starts only after a gesture.
let context
let enabled=true
try { enabled=localStorage.getItem('openbook-sound')!=='off' } catch {}
export const soundEnabled=()=>enabled
export function unlockAudio(){
  if(!enabled)return
  try{
    const Audio=window.AudioContext||window.webkitAudioContext
    if(!Audio)return
    context ||= new Audio()
    if(context.state==='suspended')context.resume().catch(()=>{})
  }catch{}
}
export function toggleSound(){
  enabled=!enabled
  try{localStorage.setItem('openbook-sound',enabled?'on':'off')}catch{}
  if(enabled){unlockAudio();sound('select')}
  return enabled
}
export function sound(event){
  if(!enabled||!context||context.state!=='running'||document.hidden)return
  const notes={select:[440],play:[523.25,659.25],turn:[659.25,880],exchange:[392,523.25],pass:[330],finish:[523.25,659.25,783.99,1046.5]}[event]
  if(!notes)return
  const start=context.currentTime
  notes.forEach((frequency,i)=>{
    const oscillator=context.createOscillator(),gain=context.createGain(),at=start+i*.095
    oscillator.type='sine';oscillator.frequency.value=frequency
    gain.gain.setValueAtTime(0,at)
    gain.gain.linearRampToValueAtTime(.045,at+.012)
    gain.gain.exponentialRampToValueAtTime(.001,at+.23)
    oscillator.connect(gain);gain.connect(context.destination)
    oscillator.start(at);oscillator.stop(at+.25)
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()}
  })
}
