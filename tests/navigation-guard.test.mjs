import test from 'node:test';import assert from 'node:assert/strict';
import {shouldGuardNavigation,hasPendingDraftImages} from '../lib/navigation-guard.ts';
const base={current:'https://leilao.example/auctions/new',href:'https://leilao.example/whatsapp'};
test('guard targets only current-tab internal page changes, preserving hashes, downloads and new tabs',()=>{
 assert.equal(shouldGuardNavigation(base),true);
 for(const options of [{href:base.current+'#main-content'},{href:base.current},{href:'https://external.example/'},{modified:true},{button:1},{prevented:true},{download:true},{target:'_blank'}])assert.equal(shouldGuardNavigation({...base,...options}),false);
 assert.equal(shouldGuardNavigation({...base,href:'/auctions/new?queue=other'}),true);
});
test('pending local photos still need protection when a partial draft saved the same text',()=>{
 const file={name:'picture.png'};
 assert.equal(hasPendingDraftImages([{file,imageUrl:'',extraFiles:[]}]),true);
 assert.equal(hasPendingDraftImages([{file,imageUrl:'https://saved.example/main.png',extraFiles:[]}]),false);
 assert.equal(hasPendingDraftImages([{file:null,imageUrl:'https://saved.example/main.png',extraFiles:[file]}]),true);
 assert.equal(hasPendingDraftImages([]),false);
});
