import assert from 'node:assert/strict';
import test from 'node:test';
import {googleAccountHint,googleEntry} from '../youtube-session.mjs';
const select=(...texts)=>googleAccountHint(texts.map(content=>({role:'user',content})));
test('resolve an explicit role without carrying a different identity into retries',()=>{
 const mapping='본계정은 main@example.com, 부계정은 second@example.com';
 assert.equal(select(mapping,'부계정으로 구독 목록 열어','다시시도'),'second@example.com');
 assert.equal(select(mapping,'본계정으로 구독 목록 열어'),'main@example.com');
 assert.equal(select('아이디는 main@example.com','부계정으로 구독 목록 열어'),'');
 assert.equal(select(mapping,'구독 목록 열어'),'');
 assert.equal(select(mapping,'부계정은 another@example.com','부계정 구독 목록'),'');
 assert.equal(select(mapping,'이번에는 third@example.com 계정으로'),'third@example.com');
 assert.equal(select('아이디는 main@example.com','유튜브 구독 목록 열어'),'main@example.com');
});
test('an unresolved identity goes to Google account selection without an email hint',()=>{
 const u=new URL(googleEntry(''));assert.equal(u.pathname,'/AccountChooser');assert.ok(!u.searchParams.has('Email'));
 assert.equal(new URL(googleEntry('second@example.com')).searchParams.get('Email'),'second@example.com');
});
