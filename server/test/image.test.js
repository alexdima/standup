'use strict';

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var http = require('http');
var test = require('node:test');

var image = require('../routes/image');

test('image metadata includes the full copyright and the archive source URL', function (t) {
	var request = http.request;
	t.after(function () { http.request = request; });
	var credit = 'Fiddlehead fern (\u00a9 Photographer / Image provider)';
	var source = 'https://www.bing.com/search?q=fern';
	http.request = function (options, callback) {
		return {
			end: function () {
				var response = new EventEmitter();
				callback(response);
				response.emit('data', JSON.stringify({
					images: [{ url: '/th?id=fern.jpg', copyright: credit, copyrightlink: source }]
				}));
				response.emit('end');
			}
		};
	};

	var status;
	var metadata;
	image.route({}, {
		writeHead: function (value) { status = value; },
		end: function (body) { metadata = JSON.parse(body); }
	});
	assert.strictEqual(status, 200);
	assert.deepStrictEqual(metadata, {
		url: 'http://www.bing.com/th?id=fern.jpg',
		label: credit,
		sourceUrl: source
	});
});
