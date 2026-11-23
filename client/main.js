/// <reference path="./declare/jquery.d.ts" />

define([
	'socketio'
], function (io) {
	'use strict';

	var socket = io.connect();
	var stage;
	var stats;
	var serverTimeOffset = 0;

	$(function () {
		if (!window.ResizeObserver) {
			console.warn('Blobby alignment cannot account for scrollbar width: ResizeObserver is unavailable');
			return;
		}
		var stageElement = document.getElementById('stage');
		var blobbySlot = document.getElementById('blobby').parentElement;
		new window.ResizeObserver(function () {
			var scrollbarWidth = stageElement.offsetWidth - stageElement.clientWidth;
			blobbySlot.style.setProperty('--stage-scrollbar-width', scrollbarWidth + 'px');
		}).observe(stageElement);
	});

	// sync from server to client
	socket.on('sync', function (s) {
		stage = s.stage;
		stats = s.stats;
		serverTimeOffset = new Date().getTime() - s.time;

		render(stage);
	});

	setInterval(function () {
		if (stage && stage.order[stage.current]) {
			var timing = speakerTiming(stage.order[stage.current]);
			$('#stage .list-row.active').toggleClass('over-time', timing.overTime);
			$('#stage .list-row.active .status').html(timing.status);
			updateBlobby(stage.order[stage.current], timing);
		}
	}, 1000);

	function updateBlobby(actor, timing) {
		var pose = !actor ? 'setup'
			: timing.overTime ? 'warning'
			: timing.nearTime ? 'overtime'
			: actor.name === 'Endgame' ? 'endgame'
			: 'speaking';
		var blobby = $('#blobby');
		var src = '/blobby/' + pose + '.png';
		if (blobby.attr('src') !== src) {
			blobby.attr('src', src);
		}
	}

	window.goto = function (idx) {
		stage.current = Math.max(0, Math.min(idx, stage.order.length));
		render(stage);
		socket.emit('goto', idx);
	}

	window.toggleDiscussionSlot = function (idx) {
		stage.order[idx].discussionSlot = !stage.order[idx].discussionSlot
		socket.emit('toggleDiscussionSlot', idx);
	}

	function render(stage) {
		var standupRunning = stage && stage.current >= 0;
		var currentSpeaker = stage.order[stage.current];
		var timing = currentSpeaker && speakerTiming(currentSpeaker);
		updateBlobby(currentSpeaker, timing);

		// Buttons
		$('#start').prop('disabled', standupRunning);
		$('#stop').prop('disabled', !standupRunning);
		$('#next').prop('disabled', !standupRunning || stage.current + 1 >= stage.order.length);
		$('#previous').prop('disabled', !standupRunning || stage.current <= 0);

		function renderSpeaker(index, actor) {
			var avatar = '';
			var name = actor.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
			var stageIcon = actor.name === 'Team Leads'
				? '<span class="codicon codicon-person-voice" aria-hidden="true"></span>'
				: actor.name === 'Endgame'
					? '<span class="codicon codicon-flag" aria-hidden="true"></span>'
					: '';
			var demoTag = standupRunning && actor.discussionSlot ? ' <span class="demo-tag">demo</span>' : '';
			var label = '<span class="speaker-label" title="' + name + '">' + name + '</span>';

			if (actor.githubId) {
				avatar = '<img class="avatar" alt="" src="https://avatars.githubusercontent.com/u/' + actor.githubId + '" />';
			}
			if (standupRunning && index !== stage.current) {
				return '<h4>' + avatar + stageIcon + '<button type="button" class="speaker-name" title="' + name + '">' + name + '</button>' + demoTag + '</h4>';
			} else {
				if (index === stage.current || index === 0) {
					return (standupRunning ? '' : '<span class="checkbox-placeholder"></span>') + '<h4>' + avatar + stageIcon + label + demoTag + '</h4>';
				} else {
					return [
						'<input class="monaco-checkbox" type="checkbox" value="checked" title="Demo" aria-label="' + name + ' has a demo" onclick="toggleDiscussionSlot(' + index + ')"' + (actor.discussionSlot ? ' checked' : '') + '>',
						'<h4>' + avatar + stageIcon + label + '</h4>'
					].join('\n');
				}
			}
		}

		// Stage
		var stageList = stage.order.map(function (actor, index) {
			var averageLabel = '';
			var selectable = standupRunning && index !== stage.current;
			var rowClass = 'list-row' + (selectable ? ' selectable' : '');
			var rowAction = selectable ? ' onclick="goto(' + index + ')"' : '';
			if (stats && stats[actor.name]) {
				var actorStats = stats[actor.name];
				var standupCount = actorStats.standupCount;
				var speakTime = actorStats.speakTime;
				if (standupCount) {
					var average = toMMSS(speakTime / standupCount / 1000);
					averageLabel = '<span class="average" title="Average speaking time"><span class="codicon codicon-history" role="img" aria-label="Average speaking time"></span><span>' + average + '</span></span>';
				}
			}

			// Active Speaker
			if (index === stage.current) {
				return [
					'<div class="' + rowClass + ' active' + (timing.overTime ? ' over-time' : '') + '" role="listitem" aria-current="true">',
					renderSpeaker(index, actor),
					'<span class="stats">' + averageLabel + '<span class="status">' + timing.status + '</span></span>',
					'</div>'
				].join('\n');
			}

			// Previous speaker
			else if (actor.stopTime) {
				var spoken = Math.floor((actor.stopTime - actor.startTime) / 1000);

				return [
					'<div class="' + rowClass + ' spoken" role="listitem"' + rowAction + '>',
					renderSpeaker(index, actor),
					'<span class="stats">' + averageLabel + '<span class="status">' + statusIcon(speakerStatus(spoken)) + '<span class="badge">' + toMMSS(spoken) + '</span></span></span>',
					'</div>'
				].join('\n');
			}

			// Future speakers
			return '<div class="' + rowClass + '" role="listitem"' + rowAction + '>' + renderSpeaker(index, actor) + '</div>';
		});

		$('#stage').empty();
		$('#stage').html(stageList.join('\n'));
	}

	// Actions
	$('#start').on('click', function () {
		stage.current = 0;
		render(stage);
		socket.emit('start');
	});

	$('#previous').on('click', function () {
		stage.current = Math.max(stage.current - 1, 0);
		render(stage);
		socket.emit('previous');
	});

	$('#next').on('click', function () {
		stage.current = Math.min(stage.current + 1, stage.order.length);
		render(stage);
		socket.emit('next');
	});

	$('#stop').on('click', function () {
		stage.current = -1;
		stage.order.forEach(function (actor) {
			delete actor.discussionSlot;
		});
		render(stage);
		socket.emit('stop');
	});

	// Helper
	function speakerStatus(seconds) {
		return seconds > 180 ? 'error' : seconds > 150 ? 'warning' : 'ok';
	}

	function statusIcon(status) {
		if (status === 'error') {
			return '<span class="codicon codicon-error status-error" title="Over time" aria-label="Over time"></span>';
		} else if (status === 'warning') {
			return '<span class="codicon codicon-warning status-warning" title="Nearly out of time" aria-label="Nearly out of time"></span>';
		}
		return '<span class="codicon codicon-pass-filled status-ok" title="On time" aria-label="On time"></span>';
	}

	function speakerTiming(actor) {
		var seconds = Math.max(0, Math.floor((Date.now() - actor.startTime - serverTimeOffset) / 1000));
		seconds = isNaN(seconds) ? 0 : seconds;
		var isTeamLead = actor.name.indexOf('Team Lead') >= 0;
		var status = speakerStatus(isTeamLead ? 0 : seconds);
		return {
			overTime: status === 'error',
			nearTime: status === 'warning',
			status: statusIcon(status) + '<span class="badge">' + toMMSS(seconds) + '</span>'
		};
	}

	function format(value) {
		var args = [];
		for (var _i = 0; _i < (arguments.length - 1); _i++) {
			args[_i] = arguments[_i + 1];
		}
		if (args.length === 0) {
			return value;
		}

		var str = value;
		var len = args.length;
		for (var i = 0; i < len; i++) {
			str = str.replace(new RegExp('\\{' + i + '\\}', 'g'), args[i]);
		}

		return str;
	}

	function toMMSS(t) {
		var sec_num = parseInt(t, 10); // don't forget the second param
		var minutes = Math.floor(sec_num / 60);
		var seconds = sec_num - (minutes * 60);

		if (minutes < 10) { minutes = "0" + minutes; }
		if (seconds < 10) { seconds = "0" + seconds; }
		var time = minutes + ':' + seconds;

		return time;
	}
});