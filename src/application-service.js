import { AppError, missing, forbidden, invalidState } from './errors.js';

// TODO-01~04: 업무 규칙과 트랜잭션을 직접 구현합니다. docs/API.md를 먼저 읽으세요.
// actor는 검증된 로그인 사용자입니다. repo의 저장 함수는 권한을 검사하지 않습니다.
// 상태 변경과 이력 저장은 함께 성공하거나 함께 실패해야 합니다.
// 승인 취소와 자동 승급은 신청 2건 + 이력 2건을 한 트랜잭션으로 처리합니다.

const alreadyApplied = () => new AppError(409,'ALREADY_APPLIED','이미 이 행사에 신청한 기록이 있습니다.');
const capacityFull = () => new AppError(409,'CAPACITY_FULL','승인 인원이 정원에 도달했습니다.');

// (R7) 하나의 요청 = 하나의 트랜잭션.
// BEGIN IMMEDIATE: 시작 시점에 쓰기 잠금을 설정, 검사(SELECT)부터 저장(INSERT/UPDATE)까지 다른 연결(다른 서버 프로세스)이 끼어들어 쓰지 못하게 함
// work()가 끝까지 성공하면 COMMIT, 어디서든 예외가 나면 ROLLBACK 후 예외를 다시 던짐(throw → app.js 오류 처리기가 응답)
// (거부 오류 4xx도, 저장 오류 500도 결국 같은 경로로 롤백되므로 "실패 시 데이터 불변(원자성)" 보장.)
function inTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work(); 
    db.exec('COMMIT'); //트랜잭션 시작 후 work가 예외없이 처리되면 commit까지 진행
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK'); //어떤 예외가 발생하더라도 트랜잭션이 열려 있으면 롤백
    throw err;
  }
}

export function createApplicationService(repo) {
  const tx = work => inTransaction(repo.db, work);

  // 운영자 기능(승인·승인 취소)의 공통 앞부분: 대상 신청 존재 여부(404) → 담당 운영자 권한(403)판단.
  // [R8 최신 상태] 반드시 트랜잭션 안에서 호출해 DB의 현재 값을 기준으로 판단하도록 함.
  function managedApplication(actor, applicationId) {
    const app = repo.application(applicationId);
    if (!app) throw missing('신청');
    const event = repo.event(app.eventId);
    if (actor.role !== 'MANAGER' || event.managerId !== actor.id) throw forbidden();
    return { app, event };
  }

  return {
    // TODO-01 신청: 행사 존재(404) → 학생 역할(403) → 중복(409 ALREADY_APPLIED) → PENDING + APPLY 이력
    apply(actor, eventId) {
      return tx(() => {
        const event = repo.event(eventId);
        if (!event) throw missing('행사');
        if (actor.role !== 'STUDENT') throw forbidden();
        // [R2 중복] 상태와 무관하게 기존 행이 있으면 거부(CANCELLED·REVOKED 포함).
        if (repo.existing(eventId, actor.id)) throw alreadyApplied();
        const created = repo.insert(eventId, actor.id);
        repo.addHistory({ applicationId: created.id, actorId: actor.id, action: 'APPLY', fromStatus: null, toStatus: 'PENDING' });
        return created;
      });
    },

    // TODO-02 대기 취소: 신청 존재(404) → 본인(403) → PENDING(409) → CANCELLED + CANCEL 이력
    // 학생의 대기 취소는 승인 자리를 비우지 않으므로 자동 승급하지 않습니다.
    cancel(actor, applicationId) {
      return tx(() => {
        const app = repo.application(applicationId);
        if (!app) throw missing('신청');
        if (actor.role !== 'STUDENT' || app.userId !== actor.id) throw forbidden();
        if (app.status !== 'PENDING') throw invalidState();
        const updated = repo.setStatus(app.id, 'CANCELLED');
        repo.addHistory({ applicationId: app.id, actorId: actor.id, action: 'CANCEL', fromStatus: 'PENDING', toStatus: 'CANCELLED' });
        return updated;
      });
    },

    // TODO-03 직접 승인: 존재(404) → 담당자(403) → PENDING(409) → 정원(409 CAPACITY_FULL) → APPROVED + APPROVE 이력
    // 운영자가 고른 신청을 승인합니다(FIFO 강제 없음).
    approve(actor, applicationId) {
      return tx(() => {
        const { app, event } = managedApplication(actor, applicationId);
        if (app.status !== 'PENDING') throw invalidState();
        // [R4 정원] APPROVED 수만 센다. 트랜잭션 안에서 세므로 잠금 이후의 최신 값입니다.
        if (repo.approvedCount(event.id) >= event.capacity) throw capacityFull();
        const updated = repo.setStatus(app.id, 'APPROVED');
        repo.addHistory({ applicationId: app.id, actorId: actor.id, action: 'APPROVE', fromStatus: 'PENDING', toStatus: 'APPROVED' });
        return updated;
      });
    },

    // TODO-04 승인 취소 + 자동 승급: 존재(404) → 담당자(403) → APPROVED(409)
    //   → ① REVOKED 저장 ② REVOKE 이력(사유) ③ 다음 대기자 선택 ④ APPROVED 저장 ⑤ AUTO_APPROVE 이력(원인 ID)
    // ①~⑤가 하나의 트랜잭션입니다. 어느 단계에서 실패해도 전체 ROLLBACK.
    // reason은 app.js에서 trim·5~200자 검사를 마친 값입니다.
    revoke(actor, applicationId, reason) {
      return tx(() => {
        const { app } = managedApplication(actor, applicationId);
        if (app.status !== 'APPROVED') throw invalidState(); // 반복 승인 취소도 여기서 409

        const revoked = repo.setStatus(app.id, 'REVOKED');
        const revokeHistoryId = repo.addHistory({ applicationId: app.id, actorId: actor.id, action: 'REVOKE', fromStatus: 'APPROVED', toStatus: 'REVOKED', reason });

        // [R5 자동 승급] 요청당 최대 1명. 대기자가 없으면 자리를 비워 둡니다.
        const next = repo.nextPending(app.eventId);
        let promoted = null;
        if (next) {
          promoted = repo.setStatus(next.id, 'APPROVED');
          repo.addHistory({ applicationId: next.id, actorId: actor.id, action: 'AUTO_APPROVE', fromStatus: 'PENDING', toStatus: 'APPROVED', causeHistoryId: revokeHistoryId });
        }
        return { revoked, promoted };
      });
    }
  };
}
