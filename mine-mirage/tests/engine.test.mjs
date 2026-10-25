import test from 'node:test';
import assert from 'node:assert/strict';
import {MineOperations} from '../web/live/modules/operations.js';
import saryarka from '../web/live/maps/saryarka.js';
import altai from '../web/live/maps/altai.js';

test('Saryarka/Altai snapshots preserve required UI and twin fields',()=>{
  for(const map of [saryarka,altai]){
    const sim=new MineOperations(map);
    const snap=sim.snapshot();
    assert.equal(snap.mapId,map.id);
    assert.ok(snap.fleet.length>=10);
    assert.ok(Array.isArray(snap.blast.holes));
    assert.equal(snap.blast.holes.length,20);
    assert.equal(typeof snap.metrics.processed,'number');
    sim.step(20);
    assert.ok(sim.snapshot().time>0);
  }
});
test('BVR changes state, cancellation can be requested',()=>{
  const sim=new MineOperations(saryarka);
  assert.equal(sim.snapshot().blast.phase,'idle');
  const started=sim.action('blast');
  assert.equal(Boolean(started),true);
  sim.step(10);
  const after=sim.snapshot();
  assert.notEqual(after.blast.phase,'idle');
  assert.ok(after.blast.drilled>=0);
  sim.action('cancelBlast');
});
