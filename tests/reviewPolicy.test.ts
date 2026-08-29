import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildReviewPolicy } from '../lib/reviewPolicy';

describe('buildReviewPolicy', () => {
  test('preserves response semantics while saving external delivery channels', () => {
    const policy = buildReviewPolicy(
      { required: true, responsePolicy: 'quorum', quorum: 2 },
      {
        required: true,
        reviewers: [' Jorian ', 'Jorian'],
        channels: ['web', 'email'],
        slaHours: 24,
        onExpiry: 'block',
        maxRevisions: 2
      }
    );

    assert.deepEqual(policy, {
      required: true,
      responsePolicy: 'quorum',
      quorum: 2,
      reviewers: ['Jorian'],
      channels: ['web', 'email'],
      slaHours: 24,
      onExpiry: 'block',
      maxRevisions: 2
    });
  });

  test('keeps a required review reachable when every channel is unchecked', () => {
    const policy = buildReviewPolicy(undefined, {
      required: true,
      reviewers: [],
      channels: [],
      slaHours: '',
      onExpiry: 'block',
      maxRevisions: ''
    });

    assert.deepEqual(policy, {
      required: true,
      reviewers: undefined,
      channels: ['web'],
      slaHours: undefined,
      onExpiry: 'block',
      maxRevisions: undefined
    });
  });

  test('removes the review policy when the gate is disabled', () => {
    assert.equal(buildReviewPolicy(
      { required: true, channels: ['email'] },
      {
        required: false,
        reviewers: ['Jorian'],
        channels: ['email'],
        slaHours: 24,
        onExpiry: 'block',
        maxRevisions: 1
      }
    ), undefined);
  });
});
