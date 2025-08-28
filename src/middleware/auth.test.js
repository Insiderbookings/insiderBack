import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from './auth.js';

process.env.JWT_SECRET = 'test-secret';

test('invalid JWT token results in 401 response', () => {
  const req = { headers: { authorization: 'Bearer invalid.token.value' } };
  const res = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  let nextErr = null;
  const next = (err) => {
    nextErr = err;
  };
  authenticate(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Invalid token' });
  assert.ok(nextErr instanceof Error);
});

