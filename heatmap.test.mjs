import assert from 'node:assert/strict'
import {dualHeatColor,dualCloudPixels} from './heatmap.js'
const base=dualHeatColor(0,0),blue=dualHeatColor(50,0),red=dualHeatColor(0,50),both=dualHeatColor(50,50)
assert.deepEqual(base,[16,25,39])
assert.ok(blue[2]>blue[0],'you are blue')
assert.ok(red[0]>red[2],'opponent is red')
assert.ok(both[0]>both[1]&&both[2]>both[1],'overlap is lavender')
assert.ok(both.every((v,i)=>v>=blue[i]&&v>=red[i]),'overlap never cancels either side')
assert.deepEqual(dualHeatColor(100,100),both,'shared 50+ ceiling')
assert.deepEqual(dualHeatColor(-1,-1),base)
const empty=Array(225).fill(0),values=[...empty];values[112]=50
const cold=dualCloudPixels(empty,empty,15,150)
assert.equal(cold.length,150*150*4)
assert.deepEqual([...cold.slice(0,4)],[...base,255])
const cloud=dualCloudPixels(values,empty,15,150)
const pixel=(image,x,y)=>[...image.slice((y*150+x)*4,(y*150+x)*4+3)]
assert.ok(pixel(cloud,74,74)[2]>200,'hot center retains peak')
assert.deepEqual(pixel(cloud,74,74),pixel(cloud,75,75),'symmetric bloom')
assert.notDeepEqual(pixel(cloud,84,74),base,'cloud blends across square boundaries')
assert.deepEqual(pixel(cloud,0,0),base,'distant squares stay cool')
const overlap=dualCloudPixels(values,values,15,150)
assert.ok(pixel(overlap,74,74)[0]>200,'both fields reach the same square')
const separated=[...empty];separated[0]=50
const mixed=dualCloudPixels(values,separated,15,150)
assert.deepEqual(pixel(mixed,74,74),pixel(cloud,74,74),'distant opponent values do not renormalize yours')
assert.equal(values[112],50,'smoothing must not change EV data')
assert.deepEqual(dualCloudPixels(values,empty,15,150),cloud,'deterministic rendering')
console.log('Dual heatmap color and cloud rendering tests passed')
