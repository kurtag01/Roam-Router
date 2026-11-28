'use strict';
'require view';
'require uci';
'require rpc';
'require ui';
'require fs';
'require roam.common as rc';

/* Notifications: phone push (ntfy) and email. Sending: /usr/libexec/roam/notify;
   events: /usr/libexec/roam/notifyd. Settings: uci roam.notify. */

const S = 'notify';
const NOTIFY = '/usr/libexec/roam/notify';
const callUciCommit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ] });

const EVENTS = [
	[ 'device', 'New devices', 'A device joins your Wi-Fi or guest network for the first time.' ],
	[ 'vpn', 'VPN', 'The VPN drops for more than a minute, and when it reconnects.' ],
	[ 'login', 'Failed sign-ins', 'A wrong password is entered on this page or over SSH.' ],
	[ 'update', 'Updates', 'A new Roam version is available, or the router was updated.' ],
	[ 'system', 'Router restarts', 'The router started up, for example after a power cut.' ]
];

/* Providers that allow sign-in with an app password. */
const PROVIDERS = {
	gmail: { name: 'Gmail', host: 'smtp.gmail.com', port: '587', sec: 'starttls',
		hint: 'Use an app password (Google Account › Security › 2-Step Verification › App passwords), not your normal password.' },
	icloud: { name: 'iCloud Mail', host: 'smtp.mail.me.com', port: '587', sec: 'starttls',
		hint: 'Use an app-specific password (account.apple.com › Sign-In and Security). The username is your full iCloud address.' },
	yahoo: { name: 'Yahoo Mail', host: 'smtp.mail.yahoo.com', port: '465', sec: 'tls',
		hint: 'Use an app password (Yahoo Account › Security › Generate app password).' },
	fastmail: { name: 'Fastmail', host: 'smtp.fastmail.com', port: '465', sec: 'tls',
		hint: 'Use an app password (Settings › Privacy & Security › App passwords).' },
	other: { name: 'Other (enter the server)', host: '', port: '', sec: 'starttls',
		hint: 'Your provider\'s SMTP server, port and security are in its help pages ("SMTP settings").' }
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function get(o) { return uci.get('roam', S, o); }
function on(o) { return get(o) == '1'; }

function sw(checked, label, sub) {
	const box = E('input', { 'type': 'checkbox', 'role': 'switch', 'checked': checked ? '' : null });
	return { box, node: E('label', { 'class': 'roam-switch' }, [ box, E('span', { 'class': 'roam-switch-track', 'aria-hidden': 'true' }),
		E('span', {}, [ label, sub ? E('span', { 'class': 'roam-muted roam-small', 'style': 'display:block;font-weight:400' }, [ sub ]) : '' ]) ]) };
}

function field(label, input, o) {
	o = o || {};
	return E('div', { 'class': 'roam-field' + (o.wide ? ' wide' : '') }, [
		E('label', { 'class': 'roam-field-label' }, [ label, o.opt ? E('span', { 'class': 'roam-muted' }, [ ' (optional)' ]) : '' ]),
		input, o.hint ? E('div', { 'class': 'roam-muted roam-small' }, [ o.hint ]) : '' ]);
}

function text(value, attrs) {
	return E('input', Object.assign({ 'type': 'text', 'value': value || '', 'autocomplete': 'off', 'spellcheck': 'false' }, attrs || {}));
}

function ago(t) {
	const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
	if (s < 60) return 'just now';
	if (s < 3600) return Math.floor(s / 60) + ' min ago';
	if (s < 86400) return Math.floor(s / 3600) + ' h ago';
	return new Date(t * 1000).toLocaleDateString();
}

return view.extend({
	load() {
		return Promise.all([
			uci.load([ 'roam', 'system' ]),
			L.resolveDefault(fs.exec(NOTIFY, [ 'log' ]), {}),
			L.resolveDefault(fs.exec(NOTIFY, [ 'qr' ]), {})
		]);
	},

	/* Read every field, check it, stage it in uci. Throws a message for the user. */
	collect() {
		const f = this.f;
		const topic = f.topic.value.trim(), server = f.server.value.trim().replace(/\/+$/, '') || 'https://ntfy.sh';
		if (f.ntfy.checked) {
			if (!/^[A-Za-z0-9_-]{6,64}$/.test(topic))
				throw 'The ntfy topic must be 6–64 letters, digits, - or _. Click "Generate" for a random one.';
			if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[^\s]*)?$/.test(server))
				throw 'The ntfy server must be a web address such as https://ntfy.sh';
		}
		const to = f.to.value.split(/[,;\s]+/).filter((x) => x);
		const from = f.from.value.trim(), user = f.user.value.trim(), host = f.host.value.trim();
		if (f.email.checked) {
			if (!/^[A-Za-z0-9.-]+$/.test(host)) throw 'Enter the SMTP server (for example smtp.gmail.com).';
			if (!to.length) throw 'Enter at least one email address to send to.';
			const bad = to.filter((a) => !EMAIL_RE.test(a))[0];
			if (bad) throw '"' + bad + '" is not a valid email address.';
			if (!EMAIL_RE.test(from || user)) throw 'Enter the sender address (From), or a username that is an email address.';
			if (f.port.value && !/^\d{1,5}$/.test(f.port.value.trim())) throw 'The port must be a number.';
		}
		if (f.enabled.checked && !f.ntfy.checked && !f.email.checked)
			throw 'Turn on phone notifications, email, or both.';

		if (!uci.get('roam', S)) uci.add('roam', 'notify', S);
		const set = (o, v) => v === '' || v == null ? uci.unset('roam', S, o) : uci.set('roam', S, o, v);
		set('enabled', f.enabled.checked ? '1' : '0');
		set('ntfy_enabled', f.ntfy.checked ? '1' : '0');
		set('ntfy_topic', topic);
		set('ntfy_server', server);
		set('ntfy_token', f.token.value.trim());
		set('email_enabled', f.email.checked ? '1' : '0');
		set('smtp_provider', f.provider.value);
		set('smtp_host', host);
		set('smtp_port', f.port.value.trim());
		set('smtp_security', f.sec.value);
		set('smtp_user', user);
		if (f.pass.value) set('smtp_pass', f.pass.value);
		set('email_from', from);
		set('email_to', to.join(', '));
		EVENTS.forEach((e) => set('ev_' + e[0], f.ev[e[0]].checked ? '1' : '0'));
	},

	/* Resolves true when saved, false when a field needs fixing (already explained). */
	save(quiet) {
		try { this.collect(); }
		catch (e) { rc.note(String(e), 'warning'); return Promise.resolve(false); }
		return uci.save().then(() => callUciCommit('roam')).catch((e) => {
			rc.note('Saving failed: ' + ((e && e.message) || e), 'danger');
			throw e;
		}).then(() => {
			this.f.pass.value = '';
			this.f.pass.placeholder = get('smtp_pass') ? 'Saved (leave empty to keep it)' : '';
			if (!quiet) rc.note('Notification settings saved.', 'info');
			return true;
		});
	},

	test(channel) {
		const out = this.f['res_' + channel];
		return this.save(true).then((ok) => {
			if (!ok) return null;
			out.className = 'roam-small roam-muted'; out.style.color = ''; out.textContent = 'Sending…';
			return fs.exec(NOTIFY, [ 'test', channel ]);
		}).then((r) => {
			if (!r) return;
			if (r.code == 0) {
				out.className = 'roam-small'; out.style.color = 'var(--roam-ok-fg)';
				out.textContent = channel == 'ntfy' ? 'Sent. It should appear on your phone within a few seconds.' : 'Sent. Check the inbox (and the spam folder) of ' + get('email_to') + '.';
			} else {
				out.className = 'roam-small roam-drop-err'; out.style.color = '';
				out.textContent = (r.stderr || r.stdout || 'Sending failed.').trim();
			}
			return this.refreshLog();
		}).catch((e) => {
			out.className = 'roam-small roam-drop-err'; out.style.color = '';
			out.textContent = 'Could not send the test: ' + ((e && e.message) || e);
		});
	},

	refreshLog() {
		return L.resolveDefault(fs.exec(NOTIFY, [ 'log' ]), {}).then((r) => this.logList.replaceChildren(...this.logItems(r)));
	},

	logItems(r) {
		const rows = String((r && r.stdout) || '').split('\n').filter((l) => l).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((x) => x);
		if (!rows.length) return [ E('li', { 'class': 'roam-muted' }, [ 'Nothing sent yet.' ]) ];
		return rows.slice(0, 12).map((x) => E('li', {}, [
			E('div', { 'class': 'grow' }, [ E('strong', {}, [ x.title ]),
				E('span', { 'class': 'roam-small roam-muted' }, [ ago(x.time) + ' · ' + x.type ]) ]),
			E('span', { 'class': 'roam-pill ' + (x.result == 'sent' ? 'ok' : 'bad'), 'title': x.result }, [ x.result == 'sent' ? 'Sent' : 'Failed' ])
		]));
	},

	render(data) {
		const self = this, f = this.f = {};
		const qr = (data[2] && data[2].code == 0 && /^<\?xml|<svg/.test(data[2].stdout || '')) ? data[2].stdout : '';

		/* ---- main switch ---- */
		const main = sw(on('enabled'), 'Send notifications', 'Turn everything on or off without losing the settings below.');
		f.enabled = main.box;
		const save = E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, () => this.save(false)) }, [ 'Save' ]);
		const mainCard = rc.card({ icon: 'bell', title: 'Notifications', pill: on('enabled') ? 'On' : 'Off', pillClass: on('enabled') ? 'ok' : '',
			body: [ E('p', { 'class': 'roam-muted' }, [ 'Get a message on your phone or by email when something happens on the router. Messages that cannot be sent right away (no Internet, kill switch, hotel sign-in page) are retried for 24 hours.' ]), main.node ],
			actions: [ save ] });

		/* ---- ntfy ---- */
		const ntfy = sw(on('ntfy_enabled'), 'Phone notifications (ntfy)');
		f.ntfy = ntfy.box;
		f.topic = text(get('ntfy_topic'), { 'class': 'roam-mono', 'placeholder': 'roam-…' });
		f.server = text(get('ntfy_server') || 'https://ntfy.sh', { 'class': 'roam-mono' });
		f.token = text(get('ntfy_token'), { 'type': 'password', 'class': 'roam-mono', 'autocomplete': 'new-password' });
		f.res_ntfy = E('div', { 'class': 'roam-small', 'aria-live': 'polite' });
		const gen = E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': () => fs.exec(NOTIFY, [ 'topic' ]).then((r) => { if (r.stdout) f.topic.value = r.stdout.trim(); }) }, [ 'Generate' ]);
		if (!f.topic.value) gen.click();
		const qrBox = qr ? E('div', { 'style': 'width:132px;height:132px;background:#fff;padding:6px;border-radius:8px;flex:none' }) : '';
		if (qrBox) { qrBox.innerHTML = qr; const s = qrBox.querySelector('svg'); if (s) { s.setAttribute('width', '100%'); s.setAttribute('height', '100%'); } }
		const ntfyCard = rc.card({ icon: 'phone', title: 'Phone', pill: on('ntfy_enabled') ? 'On' : 'Off', pillClass: on('ntfy_enabled') ? 'ok' : '', body: [
			ntfy.node,
			E('ol', { 'class': 'roam-small', 'style': 'margin:6px 0 12px 18px;padding:0;list-style:decimal' }, [
				E('li', {}, [ 'Install the free ntfy app: ', E('a', { 'href': 'https://apps.apple.com/app/ntfy/id1625396347', 'target': '_blank', 'rel': 'noopener' }, [ 'iPhone' ]), ' or ',
					E('a', { 'href': 'https://play.google.com/store/apps/details?id=io.heckel.ntfy', 'target': '_blank', 'rel': 'noopener' }, [ 'Android' ]), '.' ]),
				E('li', {}, [ 'Click Save, then in the app tap +, and subscribe to the topic below' + (qr ? ' (or scan the code with the phone\'s camera).' : '.') ]),
				E('li', {}, [ 'Click "Send test".' ])
			]),
			E('div', { 'style': 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap' }, [
				E('div', { 'class': 'roam-fields', 'style': 'flex:1;min-width:240px' }, [
					field('Topic', E('div', { 'class': 'roam-field-row' }, [ f.topic, gen ]), { wide: true,
						hint: 'Anyone who knows the topic name can read its messages. Keep the random name private.' }),
					field('Server', f.server, { wide: true }),
					field('Access token', f.token, { wide: true, opt: true, hint: 'For a protected topic or your own ntfy server.' })
				]),
				qrBox
			]),
			f.res_ntfy
		], actions: [
			E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, () => this.test('ntfy')) }, [ 'Send test' ])
		] });

		/* ---- email ---- */
		const email = sw(on('email_enabled'), 'Email');
		f.email = email.box;
		f.provider = E('select', {}, Object.keys(PROVIDERS).map((k) => E('option', { 'value': k }, [ PROVIDERS[k].name ])));
		f.host = text(get('smtp_host'), { 'class': 'roam-mono', 'placeholder': 'smtp.example.com' });
		f.port = text(get('smtp_port'), { 'inputmode': 'numeric', 'placeholder': '587' });
		f.sec = E('select', {}, [ E('option', { 'value': 'starttls' }, [ 'STARTTLS (usually port 587)' ]), E('option', { 'value': 'tls' }, [ 'SSL/TLS (usually port 465)' ]), E('option', { 'value': 'none' }, [ 'None (not recommended)' ]) ]);
		f.sec.value = get('smtp_security') || 'starttls';
		f.user = text(get('smtp_user'), { 'placeholder': 'you@gmail.com', 'autocomplete': 'username' });
		f.pass = E('input', { 'type': 'password', 'autocomplete': 'new-password', 'placeholder': get('smtp_pass') ? 'Saved (leave empty to keep it)' : '' });
		f.from = text(get('email_from'), { 'placeholder': 'Same as the username' });
		f.to = text(get('email_to'), { 'placeholder': 'you@example.com' });
		f.res_email = E('div', { 'class': 'roam-small', 'aria-live': 'polite' });
		const hint = E('p', { 'class': 'roam-small roam-muted' });
		const custom = E('div', { 'class': 'roam-fields roam-field wide' }, [ field('SMTP server', f.host), field('Port', f.port, { opt: true }), field('Security', f.sec, { wide: true }) ]);
		const pickProvider = (fill) => {
			const p = PROVIDERS[f.provider.value];
			hint.textContent = p.hint;
			if (fill && f.provider.value != 'other') { f.host.value = p.host; f.port.value = p.port; f.sec.value = p.sec; }
			custom.style.display = f.provider.value == 'other' ? '' : 'none';
		};
		f.provider.value = get('smtp_provider') || (Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].host && PROVIDERS[k].host == get('smtp_host'))[0]) || (get('smtp_host') ? 'other' : 'gmail');
		f.provider.addEventListener('change', () => pickProvider(true));
		pickProvider(!get('smtp_host'));
		const emailCard = rc.card({ icon: 'mail', title: 'Email', pill: on('email_enabled') ? 'On' : 'Off', pillClass: on('email_enabled') ? 'ok' : '', body: [
			email.node,
			E('div', { 'class': 'roam-fields', 'style': 'margin-top:8px' }, [
				field('Email provider', f.provider, { wide: true }),
				E('div', { 'class': 'roam-field wide' }, [ hint ]),
				custom,
				field('Username', f.user),
				field('Password', f.pass),
				field('Send to', f.to, { wide: true, hint: 'One or more addresses, separated by commas.' }),
				field('From', f.from, { wide: true, opt: true })
			]),
			f.res_email
		], actions: [
			E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, () => this.test('email')) }, [ 'Send test' ])
		] });

		/* ---- events ---- */
		f.ev = {};
		const evCard = rc.card({ icon: 'shield', title: 'What to send', body: [
			E('p', { 'class': 'roam-muted roam-small' }, [ 'Repeats are held back (for example one message per device, and at most one per sign-in source every 15 minutes).' ])
		].concat(EVENTS.map((e) => { const s = sw(get('ev_' + e[0]) != '0', e[1], e[2]); f.ev[e[0]] = s.box; return s.node; })),
		actions: [ E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, () => this.save(false)) }, [ 'Save' ]) ] });

		/* ---- recent ---- */
		this.logList = E('ul', { 'class': 'roam-list' }, this.logItems(data[1]));
		const logCard = rc.card({ icon: 'clock', title: 'Recently sent', body: [ this.logList ],
			actions: [ E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, 'refreshLog') }, [ 'Refresh' ]) ] });

		return E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Alerts from the router to your phone and email.' ]),
			E('div', { 'class': 'roam-grid' }, [ mainCard, ntfyCard, emailCard, evCard, logCard ])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
