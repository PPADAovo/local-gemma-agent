import assert from 'node:assert/strict';
import test from 'node:test';
import {managePlugins} from '../gemma-plugins.mjs';

test('Codex Gmail detail requests bypass the local service manager', async () => {
  const methods = [];
  const serverRunner = async work => work(async (method, params) => {
    methods.push(method);
    if (method === 'plugin/list') {
      return {marketplaces:[{name:'openai-curated-remote',plugins:[{
        id:'gmail@openai-curated-remote',
        name:'gmail',
        installed:true,
        enabled:true,
        interface:{displayName:'Gmail',shortDescription:'Read and manage Gmail'}
      }]}]};
    }
    if (method === 'plugin/read') {
      return {plugin:{apps:[{installUrl:'https://chatgpt.com/#settings/Connectors'}]}};
    }
    if (method === 'mcpServerStatus/list') {
      return {data:[{name:'codex_apps',tools:{
        'gmail.search_emails':{description:'Search email'},
        'gmail.get_profile':{description:'Read the connected profile'}
      }}],nextCursor:null};
    }
    throw new Error('Unexpected app-server method: ' + method + ' ' + JSON.stringify(params));
  });

  const result = await managePlugins({
    source:'codex',
    tab:'앱',
    id:'gmail@openai-curated-remote',
    slug:'gmail',
    action:'details'
  }, serverRunner);

  assert.equal(result.name, 'Gmail');
  assert.equal(result.available, true);
  assert.equal(result.url, 'https://chatgpt.com/#settings/Connectors');
  assert.deepEqual(result.tools.map(tool => tool.name), ['gmail.search_emails','gmail.get_profile']);
  assert.deepEqual(result.suggestions, [
    '최근 메일 대화 5개를 요약하고 결정 사항, 미결 질문, 다음 후속 조치를 정리해줘.',
    '감사인의 최신 이메일에 정중하지만 분명하게 답장 초안을 작성하고, 제공할 항목을 짧은 글머리표 목록으로 정리해줘.',
    '최근 고객 에스컬레이션 스레드를 담당자, 날짜, 이메일 참조가 포함된 실행 항목으로 정리해줘.'
  ]);
  assert.deepEqual(methods, ['plugin/list','plugin/read','mcpServerStatus/list']);
});

test('Codex app listings retain Gmail as a connectable item when app/list omits it', async () => {
  const serverRunner = async work => work(async method => {
    if (method === 'app/list') return {data:[],nextCursor:null};
    if (method === 'plugin/list') {
      return {marketplaces:[{name:'openai-curated-remote',plugins:[{
        id:'gmail@openai-curated-remote',
        name:'gmail',
        installed:false,
        enabled:false,
        interface:{displayName:'Gmail',shortDescription:'Read and manage Gmail'}
      }]}]};
    }
    throw new Error('Unexpected app-server method: ' + method);
  });

  const result = await managePlugins({source:'codex',tab:'앱'},serverRunner);

  assert.deepEqual(result.rows, [{
    id:'gmail@openai-curated-remote',
    slug:'gmail',
    name:'Gmail',
    description:'Read and manage Gmail',
    detail:'사용 꺼짐',
    installed:false,
    enabled:false,
    connected:false
  }]);
});

test('Gmail profile reads use the supported tool and preserve only provider-returned data', async () => {
  let readGmailProfile;
  try {
    ({readGmailProfile} = await import('../gmail-connector.mjs'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  assert.equal(typeof readGmailProfile, 'function');

  let call;
  const profile = await readGmailProfile(async (query, request) => {
    call = {query,request};
    return JSON.stringify({emailAddress:'person@example.test',messagesTotal:12});
  });

  assert.deepEqual(call, {query:'',request:{name:'gmail.get_profile',args:{}}});
  assert.deepEqual(profile, {emailAddress:'person@example.test',messagesTotal:12});
});

test('Gmail profile reads reject malformed results and preserve tool errors', async () => {
  let readGmailProfile;
  try {
    ({readGmailProfile} = await import('../gmail-connector.mjs'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  assert.equal(typeof readGmailProfile, 'function');

  await assert.rejects(readGmailProfile(async () => '{'), SyntaxError);
  await assert.rejects(readGmailProfile(async () => '[]'), /프로필 응답/);
  const failure = new Error('profile access denied');
  await assert.rejects(readGmailProfile(async () => { throw failure; }), error => error === failure);
});

test('Gmail detail data contains a verified account and compose-only suggestions', async () => {
  const {gmailDetailData} = await import('../gmail-connector.mjs');
  assert.equal(typeof gmailDetailData, 'function');

  const result = await gmailDetailData(async (query, request) => {
    assert.deepEqual({query,request},{query:'',request:{name:'gmail.get_profile',args:{}}});
    return JSON.stringify({emailAddress:'person@example.test',messagesTotal:12});
  });

  assert.deepEqual(result, {
    account:'person@example.test',
    suggestions:[
      '최근 메일 대화 5개를 요약하고 결정 사항, 미결 질문, 다음 후속 조치를 정리해줘.',
      '감사인의 최신 이메일에 정중하지만 분명하게 답장 초안을 작성하고, 제공할 항목을 짧은 글머리표 목록으로 정리해줘.',
      '최근 고객 에스컬레이션 스레드를 담당자, 날짜, 이메일 참조가 포함된 실행 항목으로 정리해줘.'
    ]
  });
});

test('Gmail detail data does not invent an account when the profile omits it', async () => {
  const {gmailDetailData} = await import('../gmail-connector.mjs');
  assert.equal(typeof gmailDetailData, 'function');
  const result = await gmailDetailData(async () => JSON.stringify({messagesTotal:12}));

  assert.equal(result.account, null);
});
