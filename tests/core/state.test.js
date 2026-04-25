import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../server/core/state.js';

describe('StateManager', () => {
  beforeEach(() => state.reset());

  test('初始状态为 IDLE', () => {
    assert.equal(state.current, 'IDLE');
  });

  test('IDLE → PROTO 合法转换', () => {
    state.transition('PROTO');
    assert.equal(state.current, 'PROTO');
  });

  test('PROTO → PUB → PUSH → IDLE 完整链路', () => {
    state.transition('PROTO');
    state.transition('PUB');
    state.transition('PUSH');
    state.transition('IDLE');
    assert.equal(state.current, 'IDLE');
  });

  test('PUSH → PAUSE → PUSH 暂停恢复', () => {
    state.transition('PROTO');
    state.transition('PUB');
    state.transition('PUSH');
    state.transition('PAUSE');
    assert.equal(state.current, 'PAUSE');
    state.transition('PUSH');
    assert.equal(state.current, 'PUSH');
  });

  test('非法转换 IDLE → PUSH 应抛出异常', () => {
    assert.throws(
      () => state.transition('PUSH'),
      /Illegal state transition/
    );
  });

  test('非法转换 PROTO → PAUSE 应抛出异常', () => {
    state.transition('PROTO');
    assert.throws(
      () => state.transition('PAUSE'),
      /Illegal state transition/
    );
  });

  test('transition payload 合并到 context', () => {
    state.transition('PROTO', { mood: '开心' });
    assert.equal(state.getContext().mood, '开心');
  });

  test('updateContext 不触发状态变化', () => {
    state.transition('PROTO');
    state.updateContext({ mood: '平静', volume: 60 });
    assert.equal(state.current, 'PROTO');
    assert.equal(state.getContext().mood, '平静');
    assert.equal(state.getContext().volume, 60);
  });

  test('getContext 返回深拷贝，修改不影响内部状态', () => {
    state.transition('PROTO', { queue: [{ id: '1' }] });
    const ctx = state.getContext();
    ctx.queue.push({ id: '2' });
    assert.equal(state.getContext().queue.length, 1);
  });

  test('on() 在进入指定状态时触发', () => {
    let fired = false;
    state.on('PROTO', () => { fired = true; });
    state.transition('PROTO');
    assert.equal(fired, true);
  });

  test('reset() 回到 IDLE 并清空 context', () => {
    state.transition('PROTO', { mood: '累' });
    state.reset();
    assert.equal(state.current, 'IDLE');
    assert.equal(state.getContext().mood, null);
  });
});
