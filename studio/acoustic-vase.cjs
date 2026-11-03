#!/usr/bin/env node
// WAV -> STFT -> logarithmic frequency grid -> hollow, open-top vase.
// Units: seconds, Hz, relative dB, millimetres. No audio executed during authoring.
const fs = require('node:fs');
const path = require('node:path');
const wav = require('node-wav');
const FFT = require('fft.js');

const defaults = {
  out: 'generated', channel: 0, fft: 8192, hop: 512,
  bins: 128, rings: 240, fmin: 50, fmax: 20000, floor: -80,
  height: 160, radius: 30, relief: 12, wall: 2, base: 3,
  smooth: 2, seam: 6, start: 0, end: 0, 'time-scale': 'linear', 'log-offset': 0.01
};
function cli(args) {
  if (!args.length || args.includes('--help')) {
    console.log('Usage: node acoustic-vase.cjs input.wav [--key value]\n' +
      Object.entries(defaults).map(([k,v]) => `  --${k} ${v}`).join('\n') +
      '\nend=0: full duration; smooth/seam: grid samples; time-scale: linear|log.');
    process.exit(0);
  }
  const input = args.shift(), o = {...defaults};
  while (args.length) {
    const key = args.shift().replace(/^--/, '');
    if (!(key in o) || !args.length) throw Error(`Unknown or missing option: ${key}`);
    const value = args.shift(); o[key] = typeof defaults[key] === 'number' ? Number(value) : value;
  }
  for (const [k,v] of Object.entries(o)) if (typeof v === 'number' && !Number.isFinite(v)) throw Error(`Invalid ${k}`);
  for (const k of ['channel','fft','hop','bins','rings','smooth','seam']) if (!Number.isInteger(o[k])) throw Error(`${k} must be integer`);
  if (o.fft < 16 || Math.log2(o.fft)%1 || o.hop<1 || o.hop>o.fft || o.bins<8 || o.rings<2 ||
      o.channel<0 || o.smooth<0 || o.seam<0 || o.seam>=o.bins/2 || o.floor>=0 ||
      o.fmin<=0 || o.fmax<=o.fmin || o.radius<=o.wall || o.wall<=0 || o.relief<0 ||
      o.base<=0 || o.height<=o.base || o.start<0 || o.end<0 || o['log-offset']<=0 ||
      !['linear','log'].includes(o['time-scale'])) throw Error('Invalid configuration');
  return {input,o};
}
const lerp=(a,b,t)=>a+(b-a)*t;
function resample(matrix, sourceTimes, targetTimes) {
  let k=0;
  return targetTimes.map(t=>{
    while(k+1<sourceTimes.length-1 && sourceTimes[k+1]<t) k++;
    const j=Math.min(k+1,sourceTimes.length-1);
    const u=j===k?0:Math.max(0,Math.min(1,(t-sourceTimes[k])/(sourceTimes[j]-sourceTimes[k])));
    return matrix[k].map((v,f)=>lerp(v,matrix[j][f],u));
  });
}
function smooth(matrix, passes) {
  let a=matrix.map(row=>row.slice()), T=a.length,F=a[0].length;
  for(let p=0;p<passes;p++) {
    a=a.map((row,t)=>row.map((_,f)=>(
      4*a[t][f]+a[t][(f+F-1)%F]+a[t][(f+1)%F]+
      a[Math.max(0,t-1)][f]+a[Math.min(T-1,t+1)][f])/8));
  }
  return a;
}
function weldSeam(matrix, width) {
  if(!width) return matrix;
  return matrix.map(row=>{
    const a=row.slice(), F=a.length, midpoint=(row[0]+row[F-1])/2;
    for(let i=0;i<width;i++) {
      const weight=(1+Math.cos(Math.PI*i/width))/2;
      a[i]=lerp(row[i],midpoint,weight);
      a[F-1-i]=lerp(row[F-1-i],midpoint,weight);
    }
    return a;
  });
}
function stft(signal,fsHz,o) {
  const fft=new FFT(o.fft), input=new Float64Array(o.fft), output=fft.createComplexArray();
  const window=Float64Array.from({length:o.fft},(_,i)=>0.5-0.5*Math.cos(2*Math.PI*i/o.fft));
  const gain=window.reduce((s,v)=>s+v,0);
  const high=Math.min(o.fmax,fsHz/2);
  if(high<=o.fmin) throw Error('Frequency interval exceeds Nyquist limit');
  const frequencies=Array.from({length:o.bins},(_,i)=>o.fmin*(high/o.fmin)**(i/(o.bins-1)));
  const times=[], amplitudes=[]; let reference=0;
  // Centered windows, zero padding at the signal boundaries.
  for(let center=0;center<signal.length;center+=o.hop) {
    for(let i=0;i<o.fft;i++) input[i]=(signal[center+i-o.fft/2]??0)*window[i];
    fft.realTransform(output,input);
    const magnitude=k=>Math.hypot(output[2*k],output[2*k+1])/gain;
    const row=frequencies.map(f=>{
      const index=f*o.fft/fsHz, k=Math.min(Math.floor(index),o.fft/2),j=Math.min(k+1,o.fft/2);
      const value=lerp(magnitude(k),magnitude(j),index-k);
      reference=Math.max(reference,value);return value;
    });
    times.push(center/fsHz);amplitudes.push(row);
  }
  if(!reference) throw Error('Selected channel is silent');
  const levels=amplitudes.map(row=>row.map(v=>Math.max(o.floor,20*Math.log10(Math.max(v/reference,1e-15)))));
  return {times,frequencies,levels,reference};
}
function mesh(levels,o) {
  const vertices=[], faces=[], T=levels.length,F=levels[0].length;
  const add=v=>{vertices.push(v);return vertices.length-1;};
  const outer=[],inner=[];
  for(let t=0;t<T;t++) {
    outer[t]=[];inner[t]=[];
    for(let f=0;f<F;f++) {
      const angle=2*Math.PI*f/F;
      const r=o.radius+o.relief*(levels[t][f]-o.floor)/(-o.floor);
      outer[t][f]=add([r*Math.cos(angle),r*Math.sin(angle),o.base+(o.height-o.base)*t/(T-1)]);
      // Regular cylindrical cavity; minimum radial wall thickness = wall.
      inner[t][f]=add([(o.radius-o.wall)*Math.cos(angle),(o.radius-o.wall)*Math.sin(angle),o.base+(o.height-o.base)*t/(T-1)]);
    }
  }
  const quad=(a,b,c,d)=>faces.push([a,b,c],[a,c,d]);
  for(let t=0;t<T-1;t++)for(let f=0;f<F;f++) {
    const g=(f+1)%F;
    quad(outer[t][f],outer[t][g],outer[t+1][g],outer[t+1][f]);
    quad(inner[t][f],inner[t+1][f],inner[t+1][g],inner[t][g]);
  }
  const foot=outer[0].map(v=>add([vertices[v][0],vertices[v][1],0]));
  const bottom=add([0,0,0]), cavityFloor=add([0,0,o.base]);
  for(let f=0;f<F;f++) {
    const g=(f+1)%F;
    quad(foot[f],foot[g],outer[0][g],outer[0][f]);
    faces.push([bottom,foot[g],foot[f]],[cavityFloor,inner[0][f],inner[0][g]]);
    quad(outer[T-1][f],outer[T-1][g],inner[T-1][g],inner[T-1][f]);
  }
  return {vertices,faces};
}
function writeSTL(filename,{vertices,faces}) {
  const buf=Buffer.alloc(84+50*faces.length);
  buf.write('Acoustic vase | units mm');buf.writeUInt32LE(faces.length,80);
  let pos=84;
  for(const indices of faces) {
    const [a,b,c]=indices.map(i=>vertices[i]);
    const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
    let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const norm=Math.hypot(...n); n=n.map(x=>x/norm);
    for(const value of [...n,...a,...b,...c]) {buf.writeFloatLE(value,pos);pos+=4;}
    buf.writeUInt16LE(0,pos);pos+=2;
  }
  fs.writeFileSync(filename,buf);
}
function main() {
  const {input,o}=cli(process.argv.slice(2));
  const audio=wav.decode(fs.readFileSync(input));
  const signal=audio.channelData[o.channel];
  if(!signal?.length) throw Error('Channel absent or empty');
  const data=stft(signal,audio.sampleRate,o);
  if(data.times.length<2) throw Error('Signal too short for selected hop');
  const last=data.times.at(-1), end=o.end===0?last:Math.min(o.end,last);
  if(o.start>=end) throw Error('Empty time interval');
  const targetTimes=Array.from({length:o.rings},(_,i)=>{
    const u=i/(o.rings-1), span=end-o.start, offset=o['log-offset'];
    return o.start+(o['time-scale']==='linear'?span*u:offset*Math.expm1(u*Math.log1p(span/offset)));
  });
  const sampled=resample(data.levels,data.times,targetTimes);
  const geometryLevels=smooth(weldSeam(sampled,o.seam),o.smooth);
  const model=mesh(geometryLevels,o);
  fs.mkdirSync(o.out,{recursive:true});
  fs.writeFileSync(path.join(o.out,'spectrogram.json'),JSON.stringify({
    source:path.basename(input), sampleRate:audio.sampleRate, channel:o.channel,
    layout:'levelDb[timeIndex][frequencyIndex]', units:'dB relative to global maximum on selected frequency grid',
    stft:{fftSize:o.fft,hop:o.hop,window:'periodic Hann',boundary:'zero padded, centered'},
    timeSeconds:data.times,frequencyHz:data.frequencies,levelDb:data.levels
  }));
  fs.writeFileSync(path.join(o.out,'geometry.json'),JSON.stringify({
    options:o,timeSeconds:targetTimes,frequencyHz:data.frequencies,
    levelDb:geometryLevels,notes:'Seam blend and smoothing are artistic transformations. Radius uses relative dB.'
  }));
  writeSTL(path.join(o.out,'vase.stl'),model);
  console.log(`Written spectrogram.json, geometry.json and vase.stl to ${o.out}`);
}
try { main(); } catch(e) {console.error(e.message);process.exitCode=1;}
