const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const scoreEl = document.querySelector('#score');
const highEl = document.querySelector('#highScore');
const livesEl = document.querySelector('#lives');
const overlay = document.querySelector('#overlay');
const messageEl = document.querySelector('#message');
const startBtn = document.querySelector('#startBtn');
const musicBtn = document.querySelector('#musicBtn');
const installBtn = document.querySelector('#installBtn');
let installPrompt;
addEventListener('beforeinstallprompt',e=>{
  e.preventDefault(); installPrompt=e; installBtn.hidden=false;
});
installBtn.addEventListener('click',async()=>{
  if(!installPrompt) return;
  installPrompt.prompt(); await installPrompt.userChoice;
  installPrompt=null; installBtn.hidden=true;
});
addEventListener('appinstalled',()=>{ installBtn.hidden=true; });
if('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
}

// Banda sonora chiptune original generada por el navegador: no requiere archivos externos.
let audioCtx, masterGain, leadOsc, bassOsc, musicTimer, musicOn = true, musicStep = 0;
const melody = [72,76,79,84,79,76,74,77,81,86,81,77,72,76,79,83];
const bass = [48,48,43,43,45,45,43,47];
function tone(note, when, duration, volume, type='square') {
  if(!audioCtx || !musicOn) return;
  const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
  osc.type=type; osc.frequency.value=440*Math.pow(2,(note-69)/12);
  gain.gain.setValueAtTime(0.0001,when); gain.gain.exponentialRampToValueAtTime(volume,when+.01); gain.gain.exponentialRampToValueAtTime(0.0001,when+duration);
  osc.connect(gain).connect(masterGain); osc.start(when); osc.stop(when+duration+.02);
}
function musicTick() {
  if(!audioCtx || !musicOn) return;
  const now=audioCtx.currentTime;
  tone(melody[musicStep%melody.length],now,.105,.065,'square');
  if(musicStep%2===0) tone(bass[(musicStep/2)%bass.length],now,.2,.045,'triangle');
  musicStep++;
}
async function startMusic() {
  if(!musicOn) return;
  if(!audioCtx) {
    const AudioEngine=window.AudioContext||window.webkitAudioContext;
    if(!AudioEngine) { musicBtn.textContent='SIN AUDIO'; return; }
    audioCtx=new AudioEngine();
    masterGain=audioCtx.createGain(); masterGain.gain.value=.14; masterGain.connect(audioCtx.destination);
    leadOsc=audioCtx.createOscillator(); bassOsc=audioCtx.createOscillator();
    const leadGain=audioCtx.createGain(), bassGain=audioCtx.createGain();
    leadOsc.type='square'; bassOsc.type='triangle'; leadGain.gain.value=.38; bassGain.gain.value=.32;
    leadOsc.connect(leadGain).connect(masterGain); bassOsc.connect(bassGain).connect(masterGain);
    leadOsc.start(); bassOsc.start();
  }
  if(audioCtx.state==='suspended') await audioCtx.resume();
  masterGain.gain.setTargetAtTime(.14,audioCtx.currentTime,.02);
  if(!musicTimer) {
    const playNotes=()=>{
      const now=audioCtx.currentTime;
      leadOsc.frequency.setValueAtTime(440*Math.pow(2,(melody[musicStep%melody.length]-69)/12),now);
      bassOsc.frequency.setValueAtTime(440*Math.pow(2,(bass[Math.floor(musicStep/2)%bass.length]-69)/12),now);
      musicStep++;
    };
    playNotes(); musicTimer=setInterval(playNotes,150);
  }
}
function stopMusic() {
  clearInterval(musicTimer); musicTimer=null;
  if(audioCtx&&masterGain) masterGain.gain.setTargetAtTime(.0001,audioCtx.currentTime,.02);
}
musicBtn.addEventListener('click',()=>{
  if(!audioCtx) {
    musicOn=true; musicBtn.textContent='♫ ON'; startMusic(); return;
  }
  musicOn=!musicOn; musicBtn.textContent=musicOn?'♫ ON':'♫ OFF';
  if(musicOn) startMusic(); else stopMusic();
});

const TILE = 24;
const MAP = [
  '#####################',
  '#.........#.........#',
  '#.###.###.#.###.###.#',
  '#o###.###.#.###.###o#',
  '#...................#',
  '#.###.#.#####.#.###.#',
  '#.....#...#...#.....#',
  '#####.### # ###.#####',
  '    #.#       #.#    ',
  '#####.# ##=## #.#####',
  '     .  #   #  .     ',
  '#####.# ##### #.#####',
  '    #.#       #.#    ',
  '#####.# ##### #.#####',
  '#.........#.........#',
  '#.###.###.#.###.###.#',
  '#o.......P.........o#',
  '###.#.#.#####.#.#.###',
  '#.....#...#...#.....#',
  '#.#######.#.#######.#',
  '#...................#',
  '#####################'
];
canvas.width = MAP[0].length * TILE;
canvas.height = MAP.length * TILE;

let grid, player, ghosts, score, lives, pellets, state = 'menu', last = 0, frightenedUntil = 0, invulnerableUntil = 0;
// Algunos navegadores bloquean localStorage al abrir un archivo local. El juego
// debe seguir funcionando aunque el récord no pueda guardarse.
function readHighScore() {
  try { return Number(localStorage.getItem('neonPacHigh') || 0); }
  catch { return 0; }
}
function saveHighScore(value) {
  try { localStorage.setItem('neonPacHigh', value); } catch { /* modo local */ }
}
let highScore = readHighScore();
highEl.textContent = String(highScore).padStart(5,'0');
const dirs = { left:{x:-1,y:0}, right:{x:1,y:0}, up:{x:0,y:-1}, down:{x:0,y:1} };
const ghostColors = ['#ff4f9a','#39e9ff','#ff7a45','#b66cff'];

function resetGame() {
  grid = MAP.map(row => row.split(''));
  score = 0; lives = 3; pellets = 0; frightenedUntil = 0; invulnerableUntil = 0;
  grid.forEach(row => row.forEach(c => { if(c === '.' || c === 'o') pellets++; }));
  spawnActors(); updateHud();
}
function spawnActors() {
  // Aparece en un pasillo vertical: W funciona inmediatamente para avanzar.
  player = {x:9,y:16,px:9*TILE+TILE/2,py:16*TILE+TILE/2,dir:dirs.left,next:dirs.left,speed:105,mouth:0,moving:true,stopAtCenter:false,hasMoved:false};
  ghosts = [
    {x:9,y:10,dir:dirs.left,color:ghostColors[0],speed:78,home:{x:9,y:10}},
    {x:10,y:10,dir:dirs.up,color:ghostColors[1],speed:74,home:{x:10,y:10}},
    {x:11,y:10,dir:dirs.right,color:ghostColors[2],speed:70,home:{x:11,y:10}},
    {x:10,y:12,dir:dirs.left,color:ghostColors[3],speed:68,home:{x:10,y:12}}
  ].map(g => ({...g,px:g.x*TILE+TILE/2,py:g.y*TILE+TILE/2}));
}
function updateHud() {
  scoreEl.textContent = String(score).padStart(5,'0');
  livesEl.textContent = Array(Math.max(0,lives)).fill('●').join(' ');
  if(score > highScore) { highScore=score; highEl.textContent=String(highScore).padStart(5,'0'); saveHighScore(highScore); }
}
function tileOpen(x,y) {
  if(y<0 || y>=grid.length) return false;
  if(x<0 || x>=grid[0].length) return y===10;
  return grid[y][x] !== '#' && grid[y][x] !== '=';
}
function centered(a) { return Math.abs(a.px-(a.x*TILE+TILE/2))<2 && Math.abs(a.py-(a.y*TILE+TILE/2))<2; }
function moveActor(a, dt, isPlayer=false) {
  a.x = Math.floor(a.px/TILE); a.y = Math.floor(a.py/TILE);
  if(centered(a)) {
    a.px=a.x*TILE+TILE/2; a.py=a.y*TILE+TILE/2;
    if(isPlayer && a.stopAtCenter && a.hasMoved) {
      a.moving=false; a.stopAtCenter=false; a.hasMoved=false; return;
    }
    if(isPlayer && tileOpen(a.x+a.next.x,a.y+a.next.y)) a.dir=a.next;
    if(!tileOpen(a.x+a.dir.x,a.y+a.dir.y)) {
      if(!isPlayer) chooseGhostDir(a);
      else return;
    }
    if(!isPlayer) chooseGhostDir(a);
  }
  if(!isPlayer || a.moving) {
    a.px += a.dir.x*a.speed*dt; a.py += a.dir.y*a.speed*dt;
    if(isPlayer) a.hasMoved=true;
  }
  if(a.px < -TILE/2) a.px=canvas.width+TILE/2;
  if(a.px > canvas.width+TILE/2) a.px=-TILE/2;
}
function chooseGhostDir(g) {
  const options=Object.values(dirs).filter(d=>tileOpen(g.x+d.x,g.y+d.y) && !(d.x===-g.dir.x&&d.y===-g.dir.y));
  if(!options.length) { g.dir={x:-g.dir.x,y:-g.dir.y}; return; }
  const frightened=performance.now()<frightenedUntil;
  options.sort((a,b)=>{
    const da=Math.hypot(g.x+a.x-player.x,g.y+a.y-player.y), db=Math.hypot(g.x+b.x-player.x,g.y+b.y-player.y);
    return frightened ? db-da : da-db;
  });
  g.dir = Math.random()<.72 ? options[0] : options[Math.floor(Math.random()*options.length)];
}
function update(dt, now) {
  moveActor(player,dt,true); player.mouth+=dt*12;
  player.x=Math.floor(player.px/TILE); player.y=Math.floor(player.py/TILE);
  if(grid[player.y]?.[player.x]==='.' || grid[player.y]?.[player.x]==='o') {
    const power=grid[player.y][player.x]==='o'; grid[player.y][player.x]=' '; pellets--; score+=power?50:10;
    if(power) frightenedUntil=now+6500; updateHud();
    if(!pellets) endGame(true);
  }
  ghosts.forEach(g=>{
    if(state!=='playing') return;
    g.speed=now<frightenedUntil?52:75;
    moveActor(g,dt);
    if(now>=invulnerableUntil && Math.hypot(g.px-player.px,g.py-player.py)<TILE*.62) {
      if(now<frightenedUntil) { score+=200; g.px=g.home.x*TILE+TILE/2; g.py=g.home.y*TILE+TILE/2; frightenedUntil=Math.min(frightenedUntil,now+2500); updateHud(); }
      else loseLife();
    }
  });
}
function loseLife() {
  if(state!=='playing') return;
  lives--; updateHud();
  if(lives<=0) endGame(false);
  else {
    spawnActors();
    player.moving=true;
    invulnerableUntil=performance.now()+1800;
  }
}
function endGame(won) {
  state='over'; messageEl.textContent=won?'¡Laberinto completado! Puntuación: '+score:'Fin de la partida · Puntuación: '+score;
  startBtn.textContent='JUGAR OTRA VEZ'; overlay.classList.remove('hidden');
}
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#02030b'; ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let y=0;y<grid.length;y++) for(let x=0;x<grid[y].length;x++) {
    const c=grid[y][x], px=x*TILE, py=y*TILE;
    if(c==='#') drawWall(px,py,x,y);
    else if(c==='.') { ctx.fillStyle='#dffcff'; ctx.shadowColor='#32f7ff'; ctx.shadowBlur=7; ctx.beginPath();ctx.arc(px+TILE/2,py+TILE/2,2.2,0,Math.PI*2);ctx.fill(); }
    else if(c==='o') { const r=5+Math.sin(performance.now()/130)*1.3;ctx.fillStyle='#fff';ctx.shadowColor='#ffe600';ctx.shadowBlur=15;ctx.beginPath();ctx.arc(px+TILE/2,py+TILE/2,r,0,Math.PI*2);ctx.fill(); }
  }
  ctx.shadowBlur=0; drawPlayer(); ghosts.forEach(drawGhost);
}
function drawWall(px,py,x,y) {
  ctx.fillStyle='#11194d';ctx.fillRect(px+1,py+1,TILE-2,TILE-2);
  ctx.strokeStyle='#4263ff';ctx.lineWidth=1.4;ctx.shadowColor='#304cff';ctx.shadowBlur=7;
  const open=(dx,dy)=>grid[y+dy]?.[x+dx]!=='#';ctx.beginPath();
  if(open(0,-1)){ctx.moveTo(px+2,py+2);ctx.lineTo(px+TILE-2,py+2)} if(open(0,1)){ctx.moveTo(px+2,py+TILE-2);ctx.lineTo(px+TILE-2,py+TILE-2)}
  if(open(-1,0)){ctx.moveTo(px+2,py+2);ctx.lineTo(px+2,py+TILE-2)} if(open(1,0)){ctx.moveTo(px+TILE-2,py+2);ctx.lineTo(px+TILE-2,py+TILE-2)} ctx.stroke();ctx.shadowBlur=0;
}
function drawPlayer() {
  const angle=Math.atan2(player.dir.y,player.dir.x), bite=.18+Math.abs(Math.sin(player.mouth))*.22;
  ctx.fillStyle='#ffe600';ctx.shadowColor='#ffe600';ctx.shadowBlur=14;ctx.beginPath();ctx.moveTo(player.px,player.py);ctx.arc(player.px,player.py,TILE*.43,angle+bite,angle+Math.PI*2-bite);ctx.closePath();ctx.fill();ctx.shadowBlur=0;
}
function drawGhost(g) {
  const fright=performance.now()<frightenedUntil; const x=g.px,y=g.py,r=TILE*.42;
  ctx.fillStyle=fright?'#314cff':g.color;ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=12;ctx.beginPath();ctx.arc(x,y-r*.12,r,Math.PI,0);ctx.lineTo(x+r,y+r);ctx.lineTo(x+r*.5,y+r*.68);ctx.lineTo(x,y+r);ctx.lineTo(x-r*.5,y+r*.68);ctx.lineTo(x-r,y+r);ctx.closePath();ctx.fill();ctx.shadowBlur=0;
  ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(x-r*.38,y-r*.13,r*.2,r*.27,0,0,Math.PI*2);ctx.ellipse(x+r*.38,y-r*.13,r*.2,r*.27,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=fright?'#fff':'#16235e';ctx.beginPath();ctx.arc(x-r*.38+g.dir.x*2,y-r*.13+g.dir.y*2,r*.1,0,Math.PI*2);ctx.arc(x+r*.38+g.dir.x*2,y-r*.13+g.dir.y*2,r*.1,0,Math.PI*2);ctx.fill();
}
function loop(now) {
  const dt=Math.min((now-last)/1000,.035);last=now;
  if(state==='playing') update(dt,now); draw(); requestAnimationFrame(loop);
}
function start(initialDirection) {
  if(state==='menu'||state==='over') resetGame();
  const chosenDirection=initialDirection||player.dir||dirs.left;
  player.next=chosenDirection;
  player.dir=chosenDirection;
  player.moving=true;
  player.stopAtCenter=false;
  player.hasMoved=false;
  state='playing';overlay.classList.add('hidden');last=performance.now();startMusic();
}
startBtn.addEventListener('click',()=>start());
const heldKeys=new Set();
addEventListener('keydown',e=>{
  const key={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down'}[e.key];
  if(key){
    e.preventDefault();
    heldKeys.add(key);
    if(state==='menu'||state==='over'||state==='ready'||state==='paused') start(dirs[key]);
    else if(state==='playing') { player.next=dirs[key]; player.moving=true; player.stopAtCenter=false; player.hasMoved=false; startMusic(); }
  }
  if(e.code==='Space'){e.preventDefault();if(state==='playing'){state='paused';messageEl.textContent='Juego pausado';startBtn.textContent='CONTINUAR';overlay.classList.remove('hidden')}else if(state==='paused')start();}
  if(e.key==='r'||e.key==='R'){state='over';start();}
});
addEventListener('keyup',e=>{
  const key={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down'}[e.key];
  if(!key) return;
  heldKeys.delete(key);
  // La tecla elige el rumbo; Pac-Man continúa hasta una pared.
});
document.querySelectorAll('[data-dir]').forEach(btn=>btn.addEventListener('pointerdown',e=>{
  e.preventDefault();
  const direction=dirs[btn.dataset.dir];
  if(state==='menu'||state==='over'||state==='ready'||state==='paused') start(direction);
  else if(state==='playing') { player.next=direction; player.moving=true; player.stopAtCenter=false; player.hasMoved=false; startMusic(); }
}));
addEventListener('blur',()=>{ heldKeys.clear(); });
resetGame(); requestAnimationFrame(loop);
// El navegador permitirá la música con el primer clic o tecla.
const unlockAudio=()=>startMusic();
addEventListener('pointerdown',unlockAudio,{once:true});
addEventListener('keydown',unlockAudio,{once:true});
