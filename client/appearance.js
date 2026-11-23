// Loaded synchronously in <head> so the chosen theme applies before first paint.
(function (root, factory) {
	'use strict';

	var api = factory();
	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	} else {
		root.StandupAppearance = api;
		api.init(root);
	}
})(this, function () {
	'use strict';

	var STORAGE_KEY = 'standup.appearance';
	var THEMES = ['light', 'dark', 'system'];
	var MAX_TRANSPARENCY = 60;
	var TRANSPARENCY_STEP = 5;
	var DEFAULTS = { theme: 'system', transparency: 25, tint: true };

	function normalizeSettings(value) {
		value = value && typeof value === 'object' ? value : {};
		var transparency = typeof value.transparency === 'number' ? value.transparency : NaN;
		if (isFinite(transparency)) {
			transparency = Math.round(transparency / TRANSPARENCY_STEP) * TRANSPARENCY_STEP;
			transparency = Math.min(MAX_TRANSPARENCY, Math.max(0, transparency));
		} else {
			transparency = DEFAULTS.transparency;
		}
		return {
			theme: THEMES.indexOf(value.theme) >= 0 ? value.theme : DEFAULTS.theme,
			transparency: transparency,
			tint: typeof value.tint === 'boolean' ? value.tint : DEFAULTS.tint
		};
	}

	function resolveTheme(theme, prefersLight) {
		if (theme === 'system') {
			return prefersLight ? 'light' : 'dark';
		}
		return theme;
	}

	// Saturation-weighted average so vivid regions drive the hue instead of washing out to grey.
	function computeTint(pixels) {
		var r = 0, g = 0, b = 0, total = 0;
		for (var i = 0; i + 3 < pixels.length; i += 4) {
			if (pixels[i + 3] < 128) {
				continue;
			}
			var max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
			var min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
			var weight = 0.2 + (max - min) / 255;
			r += pixels[i] * weight;
			g += pixels[i + 1] * weight;
			b += pixels[i + 2] * weight;
			total += weight;
		}
		if (!total) {
			return null;
		}
		return { r: Math.round(r / total), g: Math.round(g / total), b: Math.round(b / total) };
	}

	function init(win) {
		var doc = win.document;
		var rootElement = doc.documentElement;
		var settings = load();
		var tintColor = null;
		var lightQuery = win.matchMedia ? win.matchMedia('(prefers-color-scheme: light)') : null;

		function load() {
			try {
				return normalizeSettings(JSON.parse(win.localStorage.getItem(STORAGE_KEY)));
			} catch (e) {
				return normalizeSettings(null);
			}
		}

		function save() {
			try {
				win.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
			} catch (e) {
				// Storage may be unavailable (private mode); settings still apply for this page.
			}
		}

		function apply() {
			rootElement.setAttribute('data-theme', resolveTheme(settings.theme, !!(lightQuery && lightQuery.matches)));
			rootElement.style.setProperty('--panel-opacity', String((100 - settings.transparency) / 100));
			if (tintColor) {
				rootElement.style.setProperty('--ui-tint-color', 'rgb(' + tintColor.r + ', ' + tintColor.g + ', ' + tintColor.b + ')');
			}
			if (settings.tint && tintColor) {
				rootElement.setAttribute('data-tint', 'on');
			} else {
				rootElement.removeAttribute('data-tint');
			}
		}

		function update(partial) {
			for (var key in partial) {
				settings[key] = partial[key];
			}
			settings = normalizeSettings(settings);
			save();
			apply();
		}

		function setBackgroundImage(url, credit, sourceUrl) {
			var source = new win.URL(sourceUrl || url, url);
			if (source.protocol !== 'https:' && source.protocol !== 'http:') {
				throw new Error('Unsupported background image source URL');
			}
			doc.getElementById('image-credit').textContent = credit || 'Bing image of the day';
			doc.getElementById('image-source').href = source.href;
			doc.getElementById('image-footer').hidden = false;

			var image = new win.Image();
			image.crossOrigin = 'anonymous';
			image.onload = function () {
				try {
					var canvas = doc.createElement('canvas');
					canvas.width = canvas.height = 24;
					var context = canvas.getContext('2d');
					context.drawImage(image, 0, 0, canvas.width, canvas.height);
					tintColor = computeTint(context.getImageData(0, 0, canvas.width, canvas.height).data);
					apply();
				} catch (e) {
					// The image host may not allow CORS reads; keep the untinted theme.
				}
			};
			image.src = url;
		}

		function bindControls() {
			var toggle = doc.getElementById('appearance-toggle');
			var popover = doc.getElementById('appearance-popover');
			if (!toggle || !popover) {
				return;
			}
			var themeInputs = popover.querySelectorAll('input[name="theme"]');
			var transparency = doc.getElementById('appearance-transparency');
			var transparencyValue = doc.getElementById('appearance-transparency-value');
			var tint = doc.getElementById('appearance-tint');

			function sync() {
				for (var i = 0; i < themeInputs.length; i++) {
					themeInputs[i].checked = themeInputs[i].value === settings.theme;
				}
				transparency.value = String(settings.transparency);
				transparency.setAttribute('aria-valuetext', settings.transparency + '%');
				transparencyValue.textContent = settings.transparency + '%';
				tint.checked = settings.tint;
			}

			function setOpen(open) {
				popover.hidden = !open;
				toggle.setAttribute('aria-expanded', String(open));
				if (open) {
					sync();
					var selected = popover.querySelector('input[name="theme"]:checked');
					(selected || transparency).focus();
				}
			}

			toggle.addEventListener('click', function () {
				setOpen(popover.hidden);
			});
			popover.addEventListener('change', function (event) {
				if (event.target.name === 'theme') {
					update({ theme: event.target.value });
				} else if (event.target === tint) {
					update({ tint: tint.checked });
				}
			});
			transparency.addEventListener('input', function () {
				update({ transparency: Number(transparency.value) });
				sync();
			});
			doc.addEventListener('keydown', function (event) {
				if (event.key === 'Escape' && !popover.hidden) {
					setOpen(false);
					toggle.focus();
				}
			});
			doc.addEventListener('mousedown', function (event) {
				if (!popover.hidden && !popover.contains(event.target) && !toggle.contains(event.target)) {
					setOpen(false);
				}
			});
			sync();
		}

		if (lightQuery) {
			var onSystemThemeChange = function () {
				if (settings.theme === 'system') {
					apply();
				}
			};
			if (lightQuery.addEventListener) {
				lightQuery.addEventListener('change', onSystemThemeChange);
			} else if (lightQuery.addListener) {
				lightQuery.addListener(onSystemThemeChange);
			}
		}

		apply();
		if (doc.readyState === 'loading') {
			doc.addEventListener('DOMContentLoaded', bindControls);
		} else {
			bindControls();
		}

		win.StandupAppearance.setBackgroundImage = setBackgroundImage;
	}

	return {
		normalizeSettings: normalizeSettings,
		resolveTheme: resolveTheme,
		computeTint: computeTint,
		init: init
	};
});
