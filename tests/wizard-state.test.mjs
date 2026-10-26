import test from 'node:test';import assert from 'node:assert/strict';import {mergeImageUrls,removeUploadedFile,queuePollingDelay,pendingCreationKey,readPendingCreation,storePendingCreation} from '../lib/wizard-state.ts';
test('another saved detail preserves previous URLs, deduplicates and respects order',()=>{assert.deepEqual(mergeImageUrls(['a'],['b','b']),['a','b']);assert.equal(mergeImageUrls(['a','b','c'],['d','e']).length,4);});
test('uploads remove completed files by identity after previous completions',()=>{const files=[{name:'A'},{name:'B'},{name:'C'}];let pending=[...files];for(const file of files)pending=removeUploadedFile(pending,file);assert.deepEqual(pending,[]);assert.deepEqual(removeUploadedFile(files,files[1]),[files[0],files[2]]);});
test('hidden and terminal queues do not schedule more reads',()=>{assert.equal(queuePollingDelay('running'),15000);assert.equal(queuePollingDelay('running',true),null);assert.equal(queuePollingDelay('completed'),null);assert.equal(queuePollingDelay('cancelled'),null);});

test('a confirmed rejection keeps its operation ID and editable payload across reloads',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const key=pendingCreationKey('single','operator'),operation={eventId:'00000000-0000-0000-0000-000000000091',payload:{card:{name:'Pikachu'}},editable:true};
 storePendingCreation(storage,key,operation);assert.deepEqual(readPendingCreation(storage,key),operation);
 storePendingCreation(storage,key,{eventId:operation.eventId,payload:operation.payload});assert.equal(readPendingCreation(storage,key).editable,undefined);
 storePendingCreation(storage,key,null);assert.equal(readPendingCreation(storage,key),null);
});

test('uncertain creation survives a tab reload and remains scoped to its owner',()=>{const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};const key=pendingCreationKey('batch','operator');const pending={eventId:'00000000-0000-0000-0000-000000000091',payload:{queue:{starts_at:'2026-10-25T18:00:00Z'}}};storePendingCreation(storage,key,pending);assert.deepEqual(readPendingCreation(storage,key),pending);assert.equal(readPendingCreation(storage,pendingCreationKey('batch','other')),null);storePendingCreation(storage,key,null);assert.equal(readPendingCreation(storage,key),null);values.set(key,'invalid json');assert.equal(readPendingCreation(storage,key),null);});
