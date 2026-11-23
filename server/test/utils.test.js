'use strict';

var assert = require('assert');
var test = require('node:test');

var utils = require('../utils');

test('clone preserves nested array order and creates independent copies', function () {
	var original = {
		order: [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }]
	};
	var random = Math.random;
	var clone;
	try {
		Math.random = function () { return 0; };
		clone = utils.clone(original);
	} finally {
		Math.random = random;
	}

	assert.deepStrictEqual(clone, original);
	assert.notStrictEqual(clone, original);
	assert.notStrictEqual(clone.order, original.order);
	assert.notStrictEqual(clone.order[0], original.order[0]);
	clone.order[0].name = 'Changed';
	assert.strictEqual(original.order[0].name, 'First');
});
