/* Roam admin-password rules, shared by the first-run page (sign-in screen) and
   System > Admin password. The router checks the same rules again when saving
   (themes/roam/sysauth.ut), so keep both in step.

   Strong (default): at least 14 characters; at least 3 of lower case, upper case,
   digits, symbols (or 20+ characters, e.g. a passphrase); no runs like "aaaa",
   "1234", "abcd"; no common words like "password" or "admin".
   Not strong: anything that is not empty. */
(function (root) {
	'use strict';

	var MIN = 14, PASSPHRASE = 20;
	var COMMON = [ 'password', 'passwort', 'qwerty', 'azerty', 'letmein', 'welcome', 'admin', 'openwrt',
		'router', 'roam', 'iloveyou', 'monkey', 'dragon', 'sunshine', 'football', 'baseball', 'master',
		'secret', 'changeme', 'default', 'abc123', '123456', 'trustno1' ];

	function kinds(pw) {
		return [ /[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/ ].filter(function (r) { return r.test(pw); }).length;
	}

	/* 4 or more characters in a row that repeat or count up/down: aaaa, 1234, dcba */
	function hasRun(pw) {
		var s = pw.toLowerCase();
		for (var i = 0; i + 3 < s.length; i++) {
			var d = s.charCodeAt(i + 1) - s.charCodeAt(i);
			if (d < -1 || d > 1) continue;
			if (s.charCodeAt(i + 2) - s.charCodeAt(i + 1) == d && s.charCodeAt(i + 3) - s.charCodeAt(i + 2) == d) return true;
		}
		return false;
	}

	function commonWord(pw) {
		var s = pw.toLowerCase().replace(/0/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e')
			.replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't');
		var raw = pw.toLowerCase();
		for (var i = 0; i < COMMON.length; i++)
			if (s.indexOf(COMMON[i]) >= 0 || raw.indexOf(COMMON[i]) >= 0) return COMMON[i];
		return null;
	}

	/* -> { ok: bool, rules: [ { text, ok } ], strength: 0..4, label } */
	function check(pw, strict) {
		pw = pw || '';
		var n = Array.from(pw).length, k = kinds(pw), word = commonWord(pw);
		var rules = strict ? [
			{ text: 'At least ' + MIN + ' characters', ok: n >= MIN },
			{ text: '3 of: lower case, upper case, numbers, symbols (or ' + PASSPHRASE + '+ characters)', ok: k >= 3 || n >= PASSPHRASE },
			{ text: 'No repeats or sequences like aaaa, 1234, abcd', ok: n > 0 && !hasRun(pw) },
			{ text: word ? 'No common words (contains "' + word + '")' : 'No common words like "password" or "admin"', ok: n > 0 && !word }
		] : [
			{ text: 'Not empty', ok: n > 0 }
		];

		/* Rough strength for the meter: bits from length and character pool. */
		var pool = 0;
		if (/[a-z]/.test(pw)) pool += 26;
		if (/[A-Z]/.test(pw)) pool += 26;
		if (/[0-9]/.test(pw)) pool += 10;
		if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
		var bits = n * Math.log2(pool || 1);
		if (hasRun(pw) || word) bits /= 2;
		var strength = n == 0 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;

		return {
			ok: rules.every(function (r) { return r.ok; }),
			rules: rules,
			strength: strength,
			label: [ '', 'Weak', 'Fair', 'Strong', 'Very strong' ][strength]
		};
	}

	/* A random password that passes the strong rules: 4 groups of 5, e.g. "Hq7xk-2mWfR-..." */
	function generate() {
		var chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		for (;;) {
			var b = new Uint32Array(20), out = '';   /* 32-bit: modulo bias is negligible */
			root.crypto.getRandomValues(b);
			for (var i = 0; i < 20; i++) {
				if (i && i % 5 == 0) out += '-';
				out += chars.charAt(b[i] % chars.length);
			}
			if (check(out, true).ok && /[a-z]/.test(out) && /[A-Z]/.test(out) && /[0-9]/.test(out)) return out;
		}
	}

	root.RoamPassword = { check: check, generate: generate, MIN: MIN };
})(window);
