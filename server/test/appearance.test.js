'use strict';

var assert = require('assert');
var test = require('node:test');

var appearance = require('../../client/appearance');

test('appearance settings fall back to defaults and snap transparency to the supported range', function () {
	assert.deepStrictEqual(appearance.normalizeSettings(null), { theme: 'system', transparency: 25, tint: true });
	assert.deepStrictEqual(appearance.normalizeSettings({ theme: 'sepia', transparency: '40', tint: 'yes' }), { theme: 'system', transparency: 25, tint: true });
	assert.deepStrictEqual(appearance.normalizeSettings({ theme: 'light', transparency: 92, tint: false }), { theme: 'light', transparency: 60, tint: false });
	assert.strictEqual(appearance.normalizeSettings({ transparency: -10 }).transparency, 0);
	assert.strictEqual(appearance.normalizeSettings({ transparency: 33 }).transparency, 35);
});

test('system theme follows the OS preference while explicit themes win', function () {
	assert.strictEqual(appearance.resolveTheme('system', true), 'light');
	assert.strictEqual(appearance.resolveTheme('system', false), 'dark');
	assert.strictEqual(appearance.resolveTheme('dark', true), 'dark');
	assert.strictEqual(appearance.resolveTheme('light', false), 'light');
});

test('background tint favours saturated pixels and ignores transparent ones', function () {
	var pixels = [
		255, 0, 0, 255,
		128, 128, 128, 255,
		0, 0, 255, 0
	];
	assert.deepStrictEqual(appearance.computeTint(pixels), { r: 237, g: 18, b: 18 });
	assert.strictEqual(appearance.computeTint([0, 0, 0, 0]), null);
});

function backgroundFixture() {
	var elements = {
		'image-credit': { textContent: '' },
		'image-source': { href: '' },
		'image-footer': { hidden: true }
	};
	var win = {
		URL: URL,
		Image: function () {},
		StandupAppearance: {},
		localStorage: { getItem: function () { return null; } },
		document: {
			readyState: 'loading',
			addEventListener: function () {},
			getElementById: function (id) { return elements[id]; },
			documentElement: {
				setAttribute: function () {},
				removeAttribute: function () {},
				style: { setProperty: function () {} }
			}
		}
	};
	appearance.init(win);
	return { elements: elements, setBackgroundImage: win.StandupAppearance.setBackgroundImage };
}

test('background footer preserves full credits and links to the source, or the image when no source is supplied', function () {
	var fixture = backgroundFixture();
	var url = 'https://www.bing.com/th?id=fern.jpg';
	var credit = 'Fiddlehead fern (\u00a9 Photographer / Image provider)';
	var source = 'https://www.bing.com/search?q=fern';
	fixture.setBackgroundImage(url, credit, source);
	assert.strictEqual(fixture.elements['image-credit'].textContent, credit);
	assert.strictEqual(fixture.elements['image-source'].href, source);
	assert.strictEqual(fixture.elements['image-footer'].hidden, false);

	fixture.setBackgroundImage(url);
	assert.strictEqual(fixture.elements['image-credit'].textContent, 'Bing image of the day');
	assert.strictEqual(fixture.elements['image-source'].href, url);
});

test('background footer rejects non-web source links before displaying them', function () {
	var fixture = backgroundFixture();
	assert.throws(function () {
		fixture.setBackgroundImage('https://www.bing.com/fern.jpg', 'Photo credit', 'javascript:alert(1)');
	}, /Unsupported background image source URL/);
	assert.strictEqual(fixture.elements['image-footer'].hidden, true);
	assert.strictEqual(fixture.elements['image-source'].href, '');
});
