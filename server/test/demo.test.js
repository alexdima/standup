'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var test = require('node:test');
var vm = require('vm');

var config = require('../../config');
var db = require('../db');
var standup = require('../standup');

function call(fn) {
	var args = Array.prototype.slice.call(arguments, 1);
	return new Promise(function (resolve, reject) {
		args.push(function (err, result) {
			if (err) {
				reject(err);
			} else {
				resolve(result);
			}
		});
		fn.apply(null, args);
	});
}

function startDb(dbPath) {
	return new Promise(function (resolve, reject) {
		db.startup(function (err) {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		}, dbPath);
	});
}

test('checked participants stay marked during play and reset on stop', async function (t) {
	var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'standup-demo-'));
	var dbPath = path.join(directory, 'db.json');
	var originalUsers = config.users;
	config.users = [
		{ name: 'First Demo' },
		{ name: 'Status Only' },
		{ name: 'Second Demo' }
	];
	t.after(function () {
		config.users = originalUsers;
		if (fs.existsSync(dbPath)) {
			fs.unlinkSync(dbPath);
		}
		fs.rmdirSync(directory);
	});

	await startDb(dbPath);
	await call(standup.init);
	var stage = await call(db.getStage);
	var names = stage.order.map(function (actor) { return actor.name; });
	await call(standup.toggleDiscussionSlot, names.indexOf('First Demo'));
	await call(standup.toggleDiscussionSlot, names.indexOf('Status Only'));
	await call(standup.toggleDiscussionSlot, names.indexOf('Status Only'));
	await call(standup.toggleDiscussionSlot, names.indexOf('Second Demo'));
	await call(standup.start);

	// Verify the saved stage survives a database reload.
	await startDb(dbPath);
	stage = await call(db.getStage);
	assert.strictEqual(stage.current, 0);
	assert.strictEqual(stage.order[0].name, 'Team Leads');
	assert.strictEqual(stage.order[stage.order.length - 1].name, 'Endgame');
	assert.deepStrictEqual(stage.order.slice(1, 3).map(function (actor) {
		return actor.name;
	}).sort(), ['First Demo', 'Second Demo']);
	assert.ok(stage.order[1].discussionSlot);
	assert.ok(stage.order[2].discussionSlot);
	assert.strictEqual(stage.order[3].name, 'Status Only');
	assert.ok(!stage.order[3].discussionSlot);

	await call(standup.goto, 1);
	await call(standup.next);
	stage = await call(db.getStage);
	assert.ok(stage.order[1].discussionSlot);
	assert.ok(stage.order[2].discussionSlot);

	await call(standup.stop);
	stage = await call(db.getStage);
	assert.strictEqual(stage.current, -1);
	assert.ok(stage.order.every(function (actor) {
		return !actor.discussionSlot;
	}));
});

test('play renders demo badges, average times, and live status updates', function () {
	var elements = {};
	var socketHandlers = {};
	var tick;
	var resizeBlobby;
	var observedStage;
	var stageElement = { offsetWidth: 100, clientWidth: 100 };
	var blobbySlot = {
		style: {
			setProperty: function (name, value) { this[name] = value; }
		}
	};
	var now = Date.now();
	function FakeDate() { return new Date(now); }
	FakeDate.now = function () { return now; };
	var socket = {
		on: function (event, handler) {
			socketHandlers[event] = handler;
		},
		emit: function () {}
	};
	var browser = {
		window: {
			ResizeObserver: function (callback) {
				resizeBlobby = callback;
				this.observe = function (element) { observedStage = element; };
			}
		},
		document: {
			getElementById: function (id) {
				if (id === 'stage') { return stageElement; }
				if (id === 'blobby') { return { parentElement: blobbySlot }; }
				return null;
			}
		},
		Date: FakeDate,
		define: function (dependencies, factory) {
			factory({ connect: function () { return socket; } });
		},
		setInterval: function (callback) {
			tick = callback;
		},
		$: function (selector) {
			if (typeof selector === 'function') {
				selector();
				return;
			}
			if (!elements[selector]) {
				elements[selector] = {
					handlers: {},
					writes: 0,
					prop: function () { return this; },
					attr: function (name, value) {
						if (value === undefined) { return this[name]; }
						this[name] = value;
						this.writes++;
						return this;
					},
					empty: function () { this.writes++; this.content = ''; return this; },
					html: function (value) { this.writes++; this.content = value; return this; },
					toggleClass: function (name, value) { this[name] = value; return this; },
					on: function (event, handler) { this.handlers[event] = handler; return this; }
				};
			}
			return elements[selector];
		}
	};
	var mainPath = path.join(__dirname, '../../client/main.js');
	vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), browser, { filename: mainPath });

	assert.strictEqual(observedStage, stageElement);
	stageElement.clientWidth = 90;
	resizeBlobby();
	assert.strictEqual(blobbySlot.style['--stage-scrollbar-width'], '10px');
	stageElement.clientWidth = 100;
	resizeBlobby();
	assert.strictEqual(blobbySlot.style['--stage-scrollbar-width'], '0px');

	function heading(name) {
		return elements['#stage'].content.match(/<h4>[\s\S]*?<\/h4>/g).filter(function (value) {
			return value.indexOf(name) !== -1;
		})[0];
	}

	function row(name) {
		return elements['#stage'].content.match(/<div class="list-row[\s\S]*?<\/div>/g).filter(function (value) {
			return value.indexOf(name) !== -1;
		})[0];
	}

	var demo = { name: 'Demo Person', discussionSlot: true };
	var status = { name: 'Status Person' };
	var stage = { current: -1, order: [{ name: 'Team Leads' }, demo, status, { name: 'Endgame' }] };
	socketHandlers.sync({ stage: stage, time: now });

	assert.strictEqual(elements['#blobby'].src, '/blobby/setup.png');
	assert.match(heading('Team Leads'), /class="codicon codicon-person-voice" aria-hidden="true"/);
	assert.match(heading('Endgame'), /class="codicon codicon-flag" aria-hidden="true"/);
	assert.doesNotMatch(heading('Demo Person'), /codicon-(?:person-voice|flag)/);
	assert.match(elements['#stage'].content, /onclick="toggleDiscussionSlot\(1\)" checked/);
	assert.doesNotMatch(heading('Demo Person'), /<span\b[^>]*>demo<\/span>/);

	var idleWrites = elements['#stage'].writes;
	tick();
	tick();
	assert.strictEqual(elements['#stage'].writes, idleWrites, 'idle ticks must leave rows and checkboxes intact');

	elements['#start'].handlers.click();
	assert.strictEqual(elements['#blobby'].src, '/blobby/speaking.png');
	assert.match(heading('Team Leads'), /class="codicon codicon-person-voice" aria-hidden="true"/);
	assert.match(heading('Endgame'), /class="codicon codicon-flag" aria-hidden="true"/);
	assert.match(heading('Demo Person'), /Demo Person<\/button> <span\b[^>]*>demo<\/span>/);
	assert.doesNotMatch(heading('Status Person'), /<span\b[^>]*>demo<\/span>/);
	assert.doesNotMatch(row('Team Leads'), /class="average"/);

	browser.window.goto(1);
	assert.strictEqual(elements['#blobby'].src, '/blobby/speaking.png');
	assert.match(heading('Team Leads'), /class="codicon codicon-person-voice" aria-hidden="true"/);
	assert.match(heading('Demo Person'), /Demo Person<\/span> <span\b[^>]*>demo<\/span>/);

	demo.startTime = now - 3000;
	demo.stopTime = now - 1000;
	status.startTime = now;
	stage.current = 2;
	socketHandlers.sync({
		stage: stage,
		stats: { 'Demo Person': { standupCount: 2, speakTime: 15000 } },
		time: now
	});
	var playingWrites = elements['#stage'].writes;
	var averages = elements['#stage'].content.match(/<span class="average"[\s\S]*?<\/span><\/span>/g);
	assert.strictEqual(averages.length, 1);
	averages.forEach(function (average) {
		assert.match(average, /title="Average speaking time"/);
		assert.match(average, /class="codicon codicon-history" role="img" aria-label="Average speaking time"/);
		assert.doesNotMatch(average, />avg\b/);
	});
	assert.match(averages[0], />00:07<\/span><\/span>$/);
	assert.doesNotMatch(row('Status Person'), /class="average"/);
	assert.match(row('Status Person'), /class="status"/);
	tick();
	assert.strictEqual(elements['#stage'].writes, playingWrites, 'timer ticks must not replace speaker rows');
	assert.match(elements['#stage .list-row.active .status'].content, /status-ok/);
	assert.match(elements['#stage .list-row.active .status'].content, /<span class="badge">00:00<\/span>/);
	status.startTime = now - 180500;
	tick();
	assert.match(elements['#stage .list-row.active .status'].content, /status-warning/);
	assert.strictEqual(elements['#stage .list-row.active']['over-time'], false);
	assert.strictEqual(elements['#blobby'].src, '/blobby/overtime.png');
	status.startTime = now - 181500;
	tick();
	assert.strictEqual(elements['#stage .list-row.active']['over-time'], true);
	assert.strictEqual(elements['#blobby'].src, '/blobby/warning.png');
	var poseWrites = elements['#blobby'].writes;
	status.startTime = now - 182500;
	tick();
	assert.match(elements['#stage .list-row.active .status'].content, /status-error/);
	assert.match(elements['#stage .list-row.active .status'].content, /<span class="badge">03:02<\/span>/);
	assert.strictEqual(elements['#stage .list-row.active']['over-time'], true);
	assert.strictEqual(elements['#blobby'].writes, poseWrites, 'timer ticks must not reload the same pose');
	status.startTime = now - 183500;
	tick();
	assert.strictEqual(elements['#stage .list-row.active']['over-time'], true, 'overtime must stay set so the CSS pulse is not restarted each second');
	status.startTime = now - 3599000;
	tick();
	assert.match(elements['#stage .list-row.active .status'].content, /<span class="badge">59:59<\/span>/);
	status.startTime = now - 3600000;
	tick();
	assert.match(elements['#stage .list-row.active .status'].content, /<span class="badge">60:00<\/span>/);
	assert.strictEqual(elements['#stage'].writes, playingWrites);
	assert.match(heading('Demo Person'), /Demo Person<\/button> <span\b[^>]*>demo<\/span>/);
	assert.doesNotMatch(heading('Status Person'), /<span\b[^>]*>demo<\/span>/);

	status.startTime = now - 181500;
	socketHandlers.sync({
		stage: stage,
		stats: {
			'Demo Person': { standupCount: 0, speakTime: 0 },
			'Status Person': { standupCount: 1, speakTime: 0 }
		},
		time: now
	});
	assert.doesNotMatch(row('Demo Person'), /class="average"/);
	assert.match(row('Status Person'), /^<div class="list-row active over-time"/);
	assert.match(row('Status Person'), /class="average"[\s\S]*?>00:00<\/span><\/span>/);

	demo.startTime = now - 3666000;
	demo.stopTime = now - 1000;
	socketHandlers.sync({
		stage: stage,
		stats: { 'Demo Person': { standupCount: 2, speakTime: 7330000 } },
		time: now
	});
	assert.match(row('Demo Person'), /class="average"[\s\S]*?>61:05<\/span><\/span>/);
	assert.match(row('Demo Person'), /class="badge">61:05<\/span>/);

	stage.current = 0;
	stage.order[0].startTime = now - 181500;
	socketHandlers.sync({ stage: stage, time: now });
	assert.doesNotMatch(row('Team Leads'), /class="list-row active over-time"/);
	tick();
	assert.strictEqual(elements['#stage .list-row.active']['over-time'], false);
	assert.strictEqual(elements['#blobby'].src, '/blobby/speaking.png', 'Team Leads are exempt from timing warnings');

	browser.window.goto(3);
	assert.strictEqual(elements['#blobby'].src, '/blobby/endgame.png');
	elements['#stop'].handlers.click();
	assert.strictEqual(elements['#blobby'].src, '/blobby/setup.png');
	assert.match(elements['#stage'].content, /onclick="toggleDiscussionSlot\(1\)">/);

	socketHandlers.sync({
		stage: { current: -1, order: [{ name: 'Team Leads' }, { name: 'Demo Person' }, { name: 'Endgame' }] },
		time: now
	});
	assert.doesNotMatch(heading('Demo Person'), /<span\b[^>]*>demo<\/span>/);
});
