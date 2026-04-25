import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eventBus } from '../../server/core/event-bus.js';

describe('EventBus', () => {
  test('emit/on 能正常收发事件', () => {
    let received = null;
    eventBus.once('TEST_EVENT', (data) => { received = data; });
    eventBus.emit('TEST_EVENT', { value: 42 });
    assert.deepEqual(received, { value: 42 });
  });

  test('once 只触发一次', () => {
    let count = 0;
    eventBus.once('ONCE_TEST', () => { count++; });
    eventBus.emit('ONCE_TEST');
    eventBus.emit('ONCE_TEST');
    assert.equal(count, 1);
  });

  test('on 可多次触发', () => {
    let count = 0;
    const handler = () => { count++; };
    eventBus.on('MULTI_TEST', handler);
    eventBus.emit('MULTI_TEST');
    eventBus.emit('MULTI_TEST');
    eventBus.off('MULTI_TEST', handler);
    assert.equal(count, 2);
  });

  test('未注册事件 emit 不抛出', () => {
    assert.doesNotThrow(() => eventBus.emit('NO_LISTENER_EVENT'));
  });
});
