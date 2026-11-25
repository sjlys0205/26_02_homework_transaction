// 검증 증거 기록 스크립트 (과제 2 보고서용 · 직접 추가한 보조 파일)
// tests/assignment.test.js의 T01~T32와 같은 순서로 요청을 다시 보내고,
// 요청마다 실제 HTTP 상태·code와 요청 전후의 applications·application_history 변화를 기록합니다.
// - 매 시나리오마다 OS 임시 폴더에 새 DB를 만들고 끝나면 지웁니다. data/app.sqlite는 사용하지 않습니다.
// - 서비스·테스트 코드는 수정하지 않습니다. 판정(✔/✖)은 기대 HTTP 상태와 실제 상태의 일치 여부입니다.
// 실행: node scripts/evidence.js  → docs/evidence/T01-T32.md 생성
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const OUT = fileURLToPath(new URL('../docs/evidence/T01-T32.md', import.meta.url));
const NAMES = { 1: 'alice', 2: 'bob', 3: 'manager1', 4: 'manager2', 5: 'charlie' };
const lines = [];
const summary = [];
let total = 0, matched = 0;

async function start(path, secret) {
  const db = openDb(path);
  const server = createApp({ db, secret }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  return { db, server, base: `http://127.0.0.1:${server.address().port}` };
}
const stop = async s => { await new Promise(r => s.server.close(r)); s.db.close(); };

async function scenario(id, title, testLine, body) {
  const dir = mkdtempSync(join(tmpdir(), 'assignment2-evidence-'));
  const path = join(dir, 'evidence.sqlite');
  const secret = randomBytes(48).toString('hex');
  let s = await start(path, secret);
  const before = { total, matched };
  lines.push(`## ${id} ${title}`, '', `테스트 코드: tests/assignment.test.js:${testLine} · 새 임시 DB에서 시작`, '');

  const apps = () => s.db.prepare('SELECT * FROM applications ORDER BY id').all();
  const hist = () => s.db.prepare('SELECT * FROM application_history ORDER BY id').all();
  async function raw(method, url, token, payload) {
    const r = await fetch(s.base + url, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
    return { status: r.status, data: await r.json(), location: r.headers.get('location') };
  }
  const tokens = {};
  for (const n of Object.values(NAMES)) tokens[n] = (await raw('POST', '/api/auth/login', null, { username: n, password: 'Classroom123!' })).data.accessToken;

  const fmtApp = a => `#${a.id} ${NAMES[a.user_id]}/행사${a.event_id} ${a.status}`;
  const fmtHist = h => `이력 #${h.id} ${h.action} (신청 #${h.application_id}, 행위자 ${NAMES[h.actor_id]}#${h.actor_id}, ${h.from_status ?? '없음'}→${h.to_status}`
    + (h.reason ? `, 사유 "${h.reason}"` : '') + (h.cause_history_id ? `, 원인 이력 #${h.cause_history_id}` : '') + ')';
  function summarize(data) {
    if (!data || typeof data !== 'object') return '';
    if ('code' in data && 'message' in data) return data.code;
    if ('revoked' in data) return `revoked ${fmtApp({ id: data.revoked.id, user_id: data.revoked.userId, event_id: data.revoked.eventId, status: data.revoked.status })}, promoted ${data.promoted ? `#${data.promoted.id} ${NAMES[data.promoted.userId]} ${data.promoted.status}` : 'null'}`;
    if (Array.isArray(data)) {
      if (data.length && 'approvedCount' in data[0]) return data.map(e => `행사${e.id} 승인 ${e.approvedCount}/${e.capacity}`).join(', ');
      if (data.length && 'action' in data[0]) return `이력 ${data.length}건: ` + data.map(h => `#${h.id} ${h.action}(${h.fromStatus ?? '없음'}→${h.toStatus}, 행위자#${h.actorId}${h.reason ? `, 사유 "${h.reason}"` : ''}${h.causeHistoryId ? `, 원인 #${h.causeHistoryId}` : ''})`).join(' · ');
      return `${data.length}건`;
    }
    if ('status' in data && 'id' in data) return `신청 #${data.id} ${NAMES[data.userId]}/행사${data.eventId} ${data.status}`;
    return '';
  }

  // 요청 1건: 전후 스냅샷을 비교해 변화(또는 변화 없음)를 기록
  async function req(who, method, url, payload, expect) {
    const a0 = apps(), h0 = hist();
    const r = await raw(method, url, who ? tokens[who] ?? who : null, payload);
    const a1 = apps(), h1 = hist();
    total++; const ok = r.status === expect; if (ok) matched++;
    const shown = payload === undefined ? '' : ' ' + JSON.stringify(payload);
    lines.push(`- ${ok ? '✔' : '✖'} ${who ?? '(토큰 없음)'} ${method} ${url}${shown} → **${r.status}** ${summarize(r.data)}${r.location ? ` · Location ${r.location}` : ''} (기대 ${expect})`);
    if (method !== 'GET') {
      const changes = [];
      for (const a of a1) { const p = a0.find(x => x.id === a.id); if (!p) changes.push(`+ 신청 ${fmtApp(a)}`); else if (p.status !== a.status) changes.push(`신청 #${a.id} ${p.status}→${a.status}`); }
      for (const h of h1.slice(h0.length)) changes.push('+ ' + fmtHist(h));
      const same = JSON.stringify(a0) === JSON.stringify(a1) && JSON.stringify(h0) === JSON.stringify(h1);
      lines.push(same ? '  - DB: 변화 없음 (요청 전후 applications·application_history 전체 행 동일)' : '  - DB: ' + changes.join(' · '));
    }
    return r.data;
  }
  function state(note = '현재 상태') {
    const a = apps(), h = hist();
    const cnt = s.db.prepare("SELECT event_id, COUNT(*) n FROM applications WHERE status='APPROVED' GROUP BY event_id").all();
    lines.push(`- ${note}: 신청 ${a.length}건 [${a.map(fmtApp).join(', ')}] · 승인 인원 ${cnt.length ? cnt.map(c => `행사${c.event_id}=${c.n}`).join(', ') : '0'} · 이력 ${h.length}건`);
  }
  function sql(text, note) { s.db.exec(text); lines.push(`- [테스트와 같은 사전 조작] ${note}: \`${text}\``); }
  async function restart() {
    const a0 = apps(), h0 = hist();
    await stop(s); s = await start(path, secret);
    const same = JSON.stringify(a0) === JSON.stringify(apps()) && JSON.stringify(h0) === JSON.stringify(hist());
    lines.push(`- 서버·DB 연결 종료 후 같은 파일로 재시작 → 재시작 전후 applications·application_history 전체 행 ${same ? '동일' : '다름'}`);
  }

  const ctx = { req, state, sql, restart, hist };
  try { await body(ctx); } finally { await stop(s); rmSync(dir, { recursive: true, force: true }); }
  const n = total - before.total, m = matched - before.matched;
  lines.push('', `요청 ${n}건 중 기대 상태 일치 ${m}건`, '');
  summary.push(`${m === n ? '✔' : '✖'} ${id} ${title} (${m}/${n})`);
}

const apply = (c, who, ev = 1, body = {}, exp = 201) => c.req(who, 'POST', `/api/events/${ev}/applications`, body, exp);
const act = (c, who, id, action, exp) => c.req(who, 'POST', `/api/applications/${id}/${action}`, {}, exp);
const revoke = (c, who, id, exp, reason = '운영 사정으로 승인 취소') => c.req(who, 'POST', `/api/applications/${id}/revoke`, { reason }, exp);
const get = (c, who, id, exp = 200) => c.req(who, 'GET', `/api/applications/${id}`, undefined, exp);
const events = c => c.req(null, 'GET', '/api/events', undefined, 200);
const history = (c, who, id, exp = 200) => c.req(who, 'GET', `/api/applications/${id}/history`, undefined, exp);
async function approved(c, who, ev = 1) { const a = await apply(c, who, ev); await act(c, ev === 1 ? 'manager1' : 'manager2', a.id, 'approve', 200); return a; }

await scenario('T01', '정상 신청은 본인 ID와 PENDING으로 저장', 9, async c => { await apply(c, 'alice'); c.state(); });
await scenario('T02', '비로그인·위조 토큰의 변경은 401, 데이터 불변', 10, async c => {
  await apply(c, null, 1, {}, 401); await apply(c, 'invalid', 1, {}, 401); c.state(); });
await scenario('T03', 'userId·role·status 위조는 400, 데이터 불변', 11, async c => {
  for (const b of [{ userId: 2 }, { role: 'MANAGER' }, { status: 'APPROVED' }]) await apply(c, 'alice', 1, b, 400); c.state(); });
await scenario('T04', '대기·취소·승인 상태의 기존 신청은 모두 중복', 12, async c => {
  const a = await apply(c, 'alice'); await apply(c, 'alice', 1, {}, 409);
  await act(c, 'alice', a.id, 'cancel', 200); await apply(c, 'alice', 1, {}, 409);
  const b = await apply(c, 'bob'); await act(c, 'manager1', b.id, 'approve', 200); await apply(c, 'bob', 1, {}, 409); c.state(); });
await scenario('T05', '같은 학생이 다른 행사에 신청 가능', 13, async c => { await apply(c, 'alice', 1); await apply(c, 'alice', 2); c.state(); });
await scenario('T06', '본인의 대기 신청 취소 성공', 14, async c => { const a = await apply(c, 'alice'); await act(c, 'alice', a.id, 'cancel', 200); await get(c, 'alice', a.id); });
await scenario('T07', '타인·운영자의 학생 신청 취소는 403', 15, async c => {
  const a = await apply(c, 'alice'); for (const u of ['bob', 'manager1']) await act(c, u, a.id, 'cancel', 403); c.state(); });
await scenario('T08', '담당 운영자의 대기 신청 승인 성공', 16, async c => {
  const a = await apply(c, 'alice'); await act(c, 'manager1', a.id, 'approve', 200); await get(c, 'alice', a.id); await events(c); });
await scenario('T09', '학생·다른 행사 운영자의 승인은 403', 17, async c => {
  const a = await apply(c, 'alice'); for (const u of ['alice', 'manager2']) await act(c, u, a.id, 'approve', 403); c.state(); });
await scenario('T10', '취소 후 오래된 화면의 승인은 409, 취소 유지', 18, async c => {
  const a = await apply(c, 'alice'); await act(c, 'alice', a.id, 'cancel', 200); await act(c, 'manager1', a.id, 'approve', 409); c.state(); });
await scenario('T11', '승인 후 재승인·본인 취소는 409, 승인 유지', 19, async c => {
  const a = await apply(c, 'alice'); await act(c, 'manager1', a.id, 'approve', 200);
  await act(c, 'manager1', a.id, 'approve', 409); await act(c, 'alice', a.id, 'cancel', 409); c.state(); });
await scenario('T12', '취소 후 다시 취소는 409, 데이터 불변', 20, async c => {
  const a = await apply(c, 'alice'); await act(c, 'alice', a.id, 'cancel', 200); await act(c, 'alice', a.id, 'cancel', 409); c.state(); });
await scenario('T13', '정원은 승인 인원 기준, 초과 요청은 대기 유지', 21, async c => {
  const a = await apply(c, 'alice'), b = await apply(c, 'bob'), x = await apply(c, 'charlie');
  await act(c, 'manager1', a.id, 'approve', 200); await act(c, 'manager1', b.id, 'approve', 200);
  await act(c, 'manager1', x.id, 'approve', 409); await events(c); await get(c, 'charlie', x.id); });
await scenario('T14', '역할·대상·상태 검사 순서', 22, async c => {
  await apply(c, 'manager1', 1, {}, 403); await apply(c, 'alice', 9999, {}, 404);
  await act(c, 'manager1', 9999, 'approve', 404); await act(c, 'alice', 9999, 'cancel', 404);
  const a = await apply(c, 'alice'); await act(c, 'alice', a.id, 'cancel', 200); await act(c, 'manager2', a.id, 'approve', 403); });
await scenario('T15', '잘못된 ID, 다른 사람의 상세 조회 거부', 23, async c => {
  await c.req('alice', 'POST', '/api/events/abc/applications', {}, 400);
  const a = await apply(c, 'alice'); await get(c, 'bob', a.id, 403); await get(c, 'manager2', a.id, 403); });
await scenario('T16', 'DB 재연결 후 신청과 상태 유지', 24, async c => {
  const a = await apply(c, 'alice'); await act(c, 'manager1', a.id, 'approve', 200); await c.restart(); c.state('재시작 후'); });
await scenario('T17', '승인 취소: 대기자가 없으면 REVOKED, promoted=null', 30, async c => {
  const a = await approved(c, 'alice'); await revoke(c, 'manager1', a.id, 200); await get(c, 'alice', a.id); await events(c); await apply(c, 'alice', 1, {}, 409); });
await scenario('T18', '자동 승급: 같은 행사 created_at이 가장 이른 대기자', 36, async c => {
  const a = await approved(c, 'alice', 2), b = await apply(c, 'bob', 2), x = await apply(c, 'charlie', 2);
  c.sql(`UPDATE applications SET created_at='2026-11-02T00:00:00.000Z' WHERE id=${b.id}`, 'bob 신청 시각을 늦춤');
  c.sql(`UPDATE applications SET created_at='2026-11-01T00:00:00.000Z' WHERE id=${x.id}`, 'charlie 신청 시각을 앞당김');
  await revoke(c, 'manager2', a.id, 200); await get(c, 'bob', b.id); await events(c); });
await scenario('T19', '자동 승급: 시각이 같으면 ID 오름차순', 43, async c => {
  const a = await approved(c, 'alice', 2), b = await apply(c, 'bob', 2), x = await apply(c, 'charlie', 2);
  c.sql("UPDATE applications SET created_at='2026-11-01T00:00:00.000Z' WHERE status='PENDING'", '대기자 신청 시각을 같게 만듦');
  await revoke(c, 'manager2', a.id, 200); await get(c, 'charlie', x.id); });
await scenario('T20', '자동 승급 대상에서 취소자·다른 행사를 제외', 48, async c => {
  const a = await approved(c, 'alice', 2), b = await apply(c, 'bob', 2), x = await apply(c, 'charlie', 1);
  await act(c, 'bob', b.id, 'cancel', 200); await revoke(c, 'manager2', a.id, 200); await get(c, 'bob', b.id); await get(c, 'charlie', x.id); });
await scenario('T21', '승인 취소 권한: 학생·다른 운영자·토큰 누락 거부', 53, async c => {
  const a = await approved(c, 'alice'); for (const u of ['alice', 'bob', 'manager2']) await revoke(c, u, a.id, 403);
  await revoke(c, null, a.id, 401); c.state(); });
await scenario('T22', '승인 취소 상태: 대기·대기 취소·승인 취소 상태 거부', 58, async c => {
  const a = await apply(c, 'alice'); await revoke(c, 'manager1', a.id, 409);
  await act(c, 'alice', a.id, 'cancel', 200); await revoke(c, 'manager1', a.id, 409);
  const b = await approved(c, 'bob'); await revoke(c, 'manager1', b.id, 200); await revoke(c, 'manager1', b.id, 409);
  await act(c, 'manager1', b.id, 'approve', 409); await act(c, 'bob', b.id, 'cancel', 409); c.state(); });
await scenario('T23', '승인 취소 사유: trim 후 5~200자, 추가 필드 거부', 66, async c => {
  const a = await approved(c, 'alice');
  for (const body of [{}, { reason: 12 }, { reason: '    ' }, { reason: 'abcd' }, { reason: 'x'.repeat(201) }, { reason: '유효한 취소 사유', actorId: 4 }])
    await c.req('manager1', 'POST', `/api/applications/${a.id}/revoke`, body, 400);
  await revoke(c, 'manager1', a.id, 200, '  운영 사정으로 취소  '); await history(c, 'manager1', a.id); });
await scenario('T24', '신청·취소·승인 이력의 행위자·전후 상태·순서', 73, async c => {
  const a = await apply(c, 'alice'), b = await apply(c, 'bob'); await act(c, 'alice', a.id, 'cancel', 200); await act(c, 'manager1', b.id, 'approve', 200);
  await history(c, 'manager1', a.id); await history(c, 'manager1', b.id); });
await scenario('T25', '승인 취소와 자동 승급 이력을 원인 ID로 연결', 82, async c => {
  const a = await approved(c, 'alice'), b = await apply(c, 'bob'); await revoke(c, 'manager1', a.id, 200);
  await history(c, 'manager1', a.id); await history(c, 'manager1', b.id); });
await scenario('T26', '거부된 요청은 상태와 성공 이력을 모두 변경하지 않음', 89, async c => {
  const a = await approved(c, 'alice', 2), b = await apply(c, 'bob', 2);
  await act(c, 'manager2', b.id, 'approve', 409); await apply(c, 'alice', 2, {}, 409); await act(c, 'alice', a.id, 'cancel', 409); await revoke(c, 'manager1', a.id, 403); c.state(); });
await scenario('T27', '변경 이력 조회: 본인·담당 운영자만 허용', 93, async c => {
  const a = await apply(c, 'alice');
  for (const u of ['alice', 'manager1']) await history(c, u, a.id, 200);
  for (const u of ['bob', 'manager2']) await history(c, u, a.id, 403);
  await history(c, null, a.id, 401); await history(c, 'alice', 9999, 404); });
await scenario('T28', '신청 이력 저장 실패 시 신청 저장도 롤백', 100, async c => {
  c.sql("CREATE TRIGGER fail_apply BEFORE INSERT ON application_history WHEN NEW.action='APPLY' BEGIN SELECT RAISE(ABORT,'TEST_INJECTED_FAILURE'); END", 'APPLY 이력 저장 실패 주입');
  await apply(c, 'alice', 1, {}, 500); c.sql('DROP TRIGGER fail_apply', '실패 주입 제거'); await apply(c, 'alice'); c.state(); });
await scenario('T29', '자동 승급 이력 저장 실패 시 두 상태와 두 이력 모두 롤백', 106, async c => {
  const a = await approved(c, 'alice'), b = await apply(c, 'bob'); c.state('요청 전');
  c.sql("CREATE TRIGGER fail_auto BEFORE INSERT ON application_history WHEN NEW.action='AUTO_APPROVE' BEGIN SELECT RAISE(ABORT,'TEST_INJECTED_FAILURE'); END", 'AUTO_APPROVE 이력 저장 실패 주입');
  await revoke(c, 'manager1', a.id, 500); c.state('실패 직후');
  c.sql('DROP TRIGGER fail_auto', '실패 주입 제거'); await revoke(c, 'manager1', a.id, 200); c.state('재시도 후'); });
await scenario('T30', '승인·대기 취소·승인 취소 이력 실패도 롤백', 112, async c => {
  const a = await apply(c, 'alice'), b = await apply(c, 'bob');
  for (const [action, run] of [['APPROVE', () => act(c, 'manager1', a.id, 'approve', 500)], ['CANCEL', () => act(c, 'bob', b.id, 'cancel', 500)]]) {
    c.sql(`CREATE TRIGGER fail_change BEFORE INSERT ON application_history WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'TEST_INJECTED_FAILURE'); END`, `${action} 이력 저장 실패 주입`);
    await run(); c.sql('DROP TRIGGER fail_change', '실패 주입 제거'); }
  await act(c, 'manager1', a.id, 'approve', 200);
  c.sql("CREATE TRIGGER fail_revoke BEFORE INSERT ON application_history WHEN NEW.action='REVOKE' BEGIN SELECT RAISE(ABORT,'TEST_INJECTED_FAILURE'); END", 'REVOKE 이력 저장 실패 주입');
  await revoke(c, 'manager1', a.id, 500); c.state(); });
await scenario('T31', 'DB 재연결 후 승인 취소·승급 상태와 원인 이력 유지', 122, async c => {
  const a = await approved(c, 'alice'), b = await apply(c, 'bob'); await revoke(c, 'manager1', a.id, 200);
  await c.restart(); await history(c, 'manager1', b.id); });
await scenario('T32', '연속 승인 취소: 요청당 최대 한 명 승급, 정원·중복 이력 보호', 126, async c => {
  const a = await approved(c, 'alice'), b = await approved(c, 'bob'), x = await apply(c, 'charlie');
  await revoke(c, 'manager1', a.id, 200); await revoke(c, 'manager1', b.id, 200); await events(c);
  await revoke(c, 'manager1', a.id, 409);
  lines.push(`- AUTO_APPROVE 이력 수: ${c.hist().filter(h => h.action === 'AUTO_APPROVE').length}건`); c.state(); });

const header = [
  '# T01~T32 검증 증거 (실제 HTTP 응답과 DB 전후 변화)', '',
  `생성: ${new Date().toISOString()} · Node ${process.version} · 생성 명령: \`node scripts/evidence.js\``, '',
  '- 시나리오마다 새 임시 SQLite DB와 서버를 만들어 tests/assignment.test.js와 같은 순서로 요청합니다.',
  '- `DB:` 줄은 그 요청 직전과 직후의 applications·application_history 전체 행을 비교한 결과입니다.',
  '- ✔/✖는 기대 HTTP 상태와 실제 상태의 일치 여부입니다. 공식 판정은 `npm run test:assignment`입니다.', '',
  '## 요약', '', ...summary.map(s => `- ${s}`), '', `전체 요청 ${total}건 중 기대 상태 일치 ${matched}건`, ''];
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, [...header, ...lines].join('\n'), 'utf8');
console.log(summary.join('\n'));
console.log(`\n전체 요청 ${total}건 중 기대 상태 일치 ${matched}건 → ${OUT}`);
