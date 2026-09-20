// A continuous visual field, not another EV calculation. Each square emits a
// Gaussian bloom; max-compositing avoids inflating EV where blooms overlap.
// Exact, unsmoothed values remain in the inspector. Shared scale for both sides.
function cloudField(values,size,resolution){
  const field=new Float32Array(resolution*resolution)
  const pitch=resolution/size,sigma=pitch*.72,radius=Math.ceil(sigma*3)
  values.forEach((ev,index)=>{
    if(ev<=0)return
    const cx=(index%size+.5)*pitch,cy=(Math.floor(index/size)+.5)*pitch
    for(let y=Math.max(0,Math.floor(cy-radius));y<Math.min(resolution,cy+radius);y++){
      for(let x=Math.max(0,Math.floor(cx-radius));x<Math.min(resolution,cx+radius);x++){
        const d=((x+.5-cx)**2+(y+.5-cy)**2)/(2*sigma*sigma)
        const value=Math.min(80,ev)*Math.exp(-d),i=y*resolution+x
        field[i]=Math.max(field[i],value)
      }
    }
  })
  return field
}

// Independent, fixed-scale channels: neither side is normalized against the
// other. Overlap becomes lavender, never subtraction or winner-takes-all.
export function dualHeatColor(you,opponent){
  const norm=v=>Math.max(0,Math.min(80,v))/80
  const strength=v=>Math.pow(norm(v),.62)
  const hot=v=>Math.pow(Math.max(0,(v-30)/50),1.15)
  const a=strength(you),b=strength(opponent),ha=hot(you),hb=hot(opponent)
  return [
    Math.min(255,10+42*a+205*b+34*ha+54*hb),
    Math.min(255,18+120*a+46*b+72*ha+70*hb),
    Math.min(255,31+190*a+42*b+48*ha+28*hb)
  ].map(Math.round)
}
export function dualCloudPixels(you,opponent,size=15,resolution=240){
  const yours=cloudField(you,size,resolution),theirs=cloudField(opponent,size,resolution)
  const pixels=new Uint8ClampedArray(resolution*resolution*4)
  for(let i=0;i<yours.length;i++){
    pixels.set(dualHeatColor(yours[i],theirs[i]),i*4)
    pixels[i*4+3]=255
  }
  return pixels
}
