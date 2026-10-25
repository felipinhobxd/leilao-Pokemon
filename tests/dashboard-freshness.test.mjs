import test from 'node:test';import assert from 'node:assert/strict';
import {dashboardFreshness,updateAge} from '../lib/dashboard-freshness.ts';
const current={online:true,failed:false,lastUpdatedAt:1_000,streamConnected:true,now:2_000};
test('a subscribed stream cannot disguise offline, failed or stale dashboard data',()=>{
 assert.equal(dashboardFreshness(current).kind,'current');
 assert.equal(dashboardFreshness({...current,online:false}).kind,'offline');
 assert.equal(dashboardFreshness({...current,failed:true}).kind,'failed');
 assert.equal(dashboardFreshness({...current,now:90_999}).kind,'current');
 assert.equal(dashboardFreshness({...current,now:91_000}).kind,'stale');
 assert.equal(dashboardFreshness({...current,lastUpdatedAt:null}).kind,'loading');
 assert.equal(dashboardFreshness({...current,streamConnected:false}).kind,'disconnected');
});
test('read age handles clock changes and pluralization without any network calls',()=>{
 assert.equal(updateAge(2_000,1_000),'agora');assert.equal(updateAge(1_000,11_000),'há 10 segundos');
 assert.equal(updateAge(1_000,61_000),'há 1 minuto');assert.equal(updateAge(1_000,121_000),'há 2 minutos');
 assert.equal(updateAge(1_000,3_601_000),'há 1 hora');assert.equal(updateAge(1_000,7_201_000),'há 2 horas');
});
