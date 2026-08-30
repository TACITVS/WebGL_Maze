/**
 * Assert the rules the game is supposed to obey, continuously, over full runs.
 * The simulation only ever asked "does the loop keep moving"; a shot into a wall
 * or a kill through a ceiling keeps the loop moving fine.
 */
import {generateDungeon} from '../src/dungeon/generator.js';
import {compileDungeon} from '../src/dungeon/compiler.js';
import {DungeonPhysics} from '../src/dungeon/physics.js';
import {Swarm} from '../src/dungeon/entities.js';
import {Loadout, generateWeapon, recomputeWeapon} from '../src/dungeon/loadout.js';
import {RNG} from '../src/dungeon/rng.js';

const MAXHULL=130, MAXCHARGE=100;
const xpFor = (l)=>Math.round(14+Math.pow(l,1.95)*6.5);
const viol = new Map();
const fail = (k, d) => { if(!viol.has(k)) viol.set(k, {n:0, first:d}); viol.get(k).n++; };
const finite = (k,v) => { if(!Number.isFinite(v)) fail(k, String(v)); };

function run(seed, seconds){
  const d=generateDungeon(seed,{locks:0});
  const c=compileDungeon(d); const p=new DungeonPhysics(d,c);
  const rng=new RNG(seed^0x9e3779b9);
  const swarm=new Swarm(d,p,new RNG(seed^0x5f3759df)).populate();
  const loadout=new Loadout(rng);
  const w0=generateWeapon(rng,0); w0.level=1; recomputeWeapon(w0); loadout.addWeapon(w0);

  const room=d.roomsById.get(d.start), plan=d.floors[room.floor];
  const sp=plan.worldOf(room.cx,room.cz);
  const player={x:sp[0],z:sp[2],y:p.canOccupy(sp[0],sp[2],sp[1])??plan.elevation,
                yaw:0,pitch:0,eye:1.62,hull:MAXHULL,charge:MAXCHARGE,invuln:0};
  let level=1,xp=0,need=xpFor(1),depth=0,banked=0;
  let quota={need:34,done:0,boss:false}, riftOpen=false, floorTime=0, travel=0;

  // Any damage dealt to an enemy on a different floor than the player is a leak.
  let playerFloor = 0, burning = false;
  const realHurt = swarm.hurt.bind(swarm);
  swarm.hurt = (enemy, amount, knock, hooks) => {
    if (!burning && enemy.floor !== playerFloor && !enemy.type.boss) {
      fail('damage crossed a floor', `enemy on floor ${enemy.floor}, player on ${playerFloor}`);
    }
    finite('damage amount not finite', amount);
    if (amount < 0) fail('negative damage', amount);
    return realHurt(enemy, amount, knock, hooks);
  };

  const maxHull = () => MAXHULL + loadout.stats.maxHull;
  const hooks={ pickupBonus:0,
    onPlayerHit:(a)=>{ if(player.invuln>0)return;
      player.hull-=a*Math.max(0.25,1-loadout.stats.armour); player.invuln=0.42; },
    onWindup:()=>{},onEnemyShoot:()=>{},onNotice:()=>{},onBossWake:()=>{},onProjectileWall:()=>{},
    onFire:()=>{},onHit:()=>{},onBlast:()=>{},onChain:()=>{},
    onKill:(e)=>{ if(!quota.boss&&!riftOpen){quota.done++; if(quota.done>=quota.need)riftOpen=true;} },
    onEssence:(v)=>{ xp+=Math.max(1,Math.round(v*(1+loadout.stats.xpGain)));
      while(xp>=need){ xp-=need; level++; need=xpFor(level); banked++;
        player.hull += (maxHull()-player.hull)*0.25; } },
    onPickup:(it)=>{ if(it.kind==='health'){ if(player.hull>=maxHull())return false;
        player.hull=Math.min(maxHull(),player.hull+it.amount);}
      else { if(player.charge>=MAXCHARGE)return false; player.charge=Math.min(MAXCHARGE,player.charge+it.amount);} return true; },
  };

  const dt=1/60;
  for(let i=0;i<Math.round(seconds/dt);i++){
    floorTime+=dt;
    player.invuln=Math.max(0,player.invuln-dt);
    player.charge=Math.min(MAXCHARGE,player.charge+19*dt);
    const fi=p.floorAt(player.y);
    playerFloor = fi;

    // spend banked upgrades the way a player eventually would
    if(banked>0){ const cards=loadout.offer(depth); if(cards.length) loadout.take(cards[rng.int(cards.length)]); banked--; }

    let nearest=null,nd=1e9,cxs=0,czs=0,n=0;
    for(const e of swarm.enemies){ if(e.hp<=0||e.floor!==fi)continue;
      const dx=e.x-player.x,dz=e.z-player.z,dd=Math.hypot(dx,dz);
      if(dd<nd){nd=dd;nearest=e;} if(dd<20){cxs+=dx;czs+=dz;n++;} }
    if(n) player.yaw=Math.atan2(cxs/n,-(czs/n));
    const spd=1+loadout.stats.moveSpeed;
    if(nearest&&nd<5.5){ const a=[player.x-nearest.x,player.z-nearest.z],l=Math.hypot(a[0],a[1])||1;
      p.move(player,(a[0]/l)*8.4*dt*spd,(a[1]/l)*8.4*dt*spd); }
    else { const a=i/60*0.7; p.move(player,Math.cos(a)*5.7*dt*spd,Math.sin(a)*5.7*dt*spd); }

    const origin=[player.x,player.y+player.eye,player.z];
    const cp=Math.cos(player.pitch);
    const fwd=[Math.sin(player.yaw)*cp,Math.sin(player.pitch),-Math.cos(player.yaw)*cp];
    const target=swarm.targetFor(origin,fwd,fi);
    const bonus={damage:loadout.stats.damage,area:loadout.stats.area,crit:loadout.stats.crit};
    for(const w of loadout.weapons){ if(w.stats.aim==='orbit')continue;
      w.cooldownLeft-=dt*(1+loadout.stats.haste);
      if(!target){ w.cooldownLeft=Math.max(0,w.cooldownLeft); continue; }
      if(w.cooldownLeft>0)continue;
      w.cooldownLeft+=Math.max(0.08,w.stats.cooldown);
      swarm.fireWeapon(w,origin,fwd,fi,bonus,hooks,target); }

    hooks.pickupBonus=loadout.stats.pickupRadius;
    swarm.desperation=Math.max(0,1-player.hull/maxHull());
    burning = true; swarm.update(dt,player,hooks); burning = false;
    swarm.spawnWave(dt,player,fi,Math.min(1.4,floorTime/110+(riftOpen?0.4:0)));

    // ---- invariants -----------------------------------------------------
    finite('player.x', player.x); finite('player.y', player.y); finite('player.z', player.z);
    finite('player.hull', player.hull); finite('player.charge', player.charge);
    if(player.hull > maxHull()+0.001) fail('hull above max', `${player.hull.toFixed(1)} > ${maxHull()}`);
    if(player.charge > MAXCHARGE+0.001) fail('charge above max', player.charge);
    if(player.charge < -0.001) fail('negative charge', player.charge);
    if(xp < 0) fail('negative xp', xp);
    if(quota.done > quota.need && !riftOpen) fail('quota overshoot without rift', `${quota.done}/${quota.need}`);
    if(swarm.enemies.length > 150) fail('enemy hard cap exceeded', swarm.enemies.length);
    for(const pr of swarm.projectiles){
      finite('projectile x', pr.x); finite('projectile damage', pr.damage);
      if(pr.floor === undefined) fail('projectile with no floor', pr.weapon && pr.weapon.aim);
    }
    for(const m of swarm.motes){ if(!(m.value > 0)) fail('mote with no value', m.value); }
    for(const e of swarm.enemies){
      finite('enemy x', e.x); finite('enemy hp', e.hp);
      if(e.hp > e.maxHp + 0.001) fail('enemy hp above max', `${e.hp}/${e.maxHp}`);
    }
    for(const w of loadout.weapons){
      finite('weapon damage', w.stats.damage);
      if(w.stats.cooldown < 0) fail('negative cooldown', w.stats.cooldown);
      if(w.level > 9) fail('weapon over max level', w.level);
    }
    if(loadout.weapons.length > loadout.maxWeapons) fail('weapon rack over cap', loadout.weapons.length);

    if(riftOpen && !quota.boss){ travel+=dt;
      if(travel>22){ const next=Math.min(d.floorCount-1,depth+1);
        if(!swarm.spawnTiles) swarm.buildSpawnTiles();
        const tiles=swarm.spawnTiles[next]||[]; const lower=d.floors[next]; let placed=false;
        for(let k=0;k<tiles.length&&!placed;k+=2){ const w=lower.worldOf(tiles[k],tiles[k+1]);
          const y=p.canOccupy(w[0],w[2],w[1],w[1]); if(y===null||p.floorAt(y)!==next)continue;
          player.x=w[0];player.z=w[2];player.y=y;placed=true; }
        depth=next; player.hull=Math.min(maxHull(),player.hull+30); player.charge=MAXCHARGE;
        quota={need: depth===d.floorCount-1?0:34+depth*22, done:0, boss: depth===d.floorCount-1};
        riftOpen=quota.boss; floorTime=0; travel=0; }
    }
    if(player.hull<=0) return;
  }
}

const seeds=(process.argv[2]||'1,2,3,4,5,6,7,8').split(',').map(Number);
const secs=Number(process.argv[3]||180);
for(const s of seeds) run(s, secs);
if(viol.size===0){ console.log(`no invariant violated across ${seeds.length} seeds x ${secs}s`); }
else { console.log('VIOLATIONS:');
  for(const [k,v] of viol) console.log(`  ${k}: ${v.n} times (first: ${v.first})`); }
