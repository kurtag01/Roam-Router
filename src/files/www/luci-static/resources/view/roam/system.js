'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require fs';
'require roam.common as rc';

/* Hostname, time zone, admin password, reboot, links to upgrade/backup. */

const callTimezones = rpc.declare({ object: 'luci', method: 'getTimezones', expect: { '': {} } });
const callSetPassword = rpc.declare({ object: 'luci', method: 'setPassword', params: [ 'username', 'password' ], expect: { result: false } });
const callReboot = rpc.declare({ object: 'system', method: 'reboot', expect: { result: 0 } });
const callUciCommit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ] });

/* Shared password rules (also used by the first-run page): plain script, not a LuCI module. */
function loadRules() {
	if (window.RoamPassword) return Promise.resolve();
	return new Promise((resolve) => {
		const s = document.createElement('script');
		s.src = L.env.media + '/password.js';
		s.onload = s.onerror = () => resolve();
		document.head.appendChild(s);
	});
}

return view.extend({
	load() {
		return Promise.all([ L.resolveDefault(callTimezones(), {}), uci.load([ 'system', 'network', 'roam' ]), loadRules() ]);
	},

	passwordCard() {
		const R = window.RoamPassword;
		const p1 = E('input', { 'type': 'password', 'autocomplete': 'new-password', 'spellcheck': 'false' });
		const p2 = E('input', { 'type': 'password', 'autocomplete': 'new-password', 'spellcheck': 'false' });
		const strict = E('input', { 'type': 'checkbox', 'role': 'switch', 'checked': uci.get('roam', 'main', 'strong_password') != '0' ? '' : null });
		const bar = E('span'), label = E('div', { 'class': 'roam-meter-label', 'aria-live': 'polite' });
		const rules = E('ul', { 'class': 'roam-rules' });
		const weak = E('p', { 'class': 'roam-muted roam-small roam-weak-note' }, [ 'Any password is accepted. A short or simple one is easy to guess for anyone on your Wi-Fi.' ]);
		const sugg = E('div', { 'class': 'roam-suggestion', 'hidden': '' });
		const show = E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': () => {
			const on = p1.type == 'password'; p1.type = p2.type = on ? 'text' : 'password'; show.textContent = on ? 'Hide' : 'Show';
		} }, [ 'Show' ]);
		const LEVEL = [ '', 'weak', 'fair', 'strong', 'vstrong' ];
		const update = () => {
			if (!R) return;
			const r = R.check(p1.value, strict.checked);
			rules.hidden = !strict.checked; weak.hidden = strict.checked;
			rules.replaceChildren(...r.rules.map((x) => E('li', { 'class': p1.value ? (x.ok ? 'ok' : 'bad') : '' }, [ x.text ])));
			bar.className = LEVEL[r.strength];
			label.textContent = p1.value ? 'Strength: ' + r.label : '';
		};
		[ p1, p2 ].forEach((el) => el.addEventListener('input', update));
		strict.addEventListener('change', update);

		const save = () => {
			if (R) {
				const r = R.check(p1.value, strict.checked);
				if (!r.ok) return rc.note(strict.checked ? 'This password does not meet the strong-password rules (or turn "Require a strong password" off).' : 'Enter a password.', 'warning');
			}
			else if (!p1.value) return rc.note('Enter a password.', 'warning');
			if (p1.value != p2.value) return rc.note('The passwords do not match.', 'warning');
			return callSetPassword('root', p1.value).then((ok) => {
				if (!ok) return rc.note('Changing the password failed.', 'danger');
				p1.value = p2.value = ''; sugg.hidden = true; update();
				rc.note('Admin password changed. It is also the password for SSH (user "root").', 'info');
				uci.set('roam', 'main', 'strong_password', strict.checked ? '1' : '0');
				return uci.save().then(() => L.resolveDefault(callUciCommit('roam')));
			});
		};
		update();
		return rc.card({ icon: 'lock', title: 'Admin password', body: [
			E('p', { 'class': 'roam-muted roam-small' }, [ 'Used to sign in here and over SSH (user "root").' ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'New password' ]), E('div', { 'class': 'cbi-value-field' }, [
				E('div', { 'class': 'roam-pw-row' }, [ p1, show ]),
				E('div', { 'class': 'roam-meter' }, [ bar ]), label ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'Confirm' ]), E('div', { 'class': 'cbi-value-field' }, [ p2 ]) ]),
			sugg,
			E('label', { 'class': 'roam-switch' }, [ strict, E('span', { 'class': 'roam-switch-track', 'aria-hidden': 'true' }), E('span', {}, [ 'Require a strong password ', E('span', { 'class': 'roam-muted roam-small' }, [ '(recommended)' ]) ]) ]),
			rules, weak
		], actions: [
			E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, save) }, [ 'Change password' ]),
			R ? E('button', { 'class': 'btn cbi-button', 'click': () => {
				const p = R.generate();
				p1.value = p2.value = p; p1.type = p2.type = 'text'; show.textContent = 'Hide';
				sugg.replaceChildren(E('code', {}, [ p ]), E('span', { 'class': 'roam-muted roam-small' }, [ 'Filled in above. Save it in your password manager, then click "Change password".' ]));
				sugg.hidden = false; update();
			} }, [ 'Suggest a strong password' ]) : ''
		] });
	},

	privacyCard() {
		const profile = uci.get('roam', 'main', 'dhcp_profile') || 'minimal';
		const UPLINKS = [ 'wan', 'wwan', 'tether', 'tether_ios' ];
		const sending = UPLINKS.some((n) => uci.get('network', n) && uci.get('network', n, 'hostname') != '*');
		const sel = E('select', {}, [
			E('option', { 'value': 'windows' }, [ 'Windows PC (recommended)' ]),
			E('option', { 'value': 'minimal' }, [ 'Minimal (recognizable as Linux/OpenWrt)' ])
		]);
		sel.value = profile;
		const box = E('input', { 'type': 'checkbox', 'checked': sending ? '' : null });
		const save = () => fs.exec('/usr/libexec/roam/dhcp-profile', [ sel.value, box.checked ? '1' : '0' ]).then((r) => {
			if (r.code != 0) return rc.note('Saving failed: ' + (r.stderr || r.code), 'danger');
			rc.note('Saved. Connections to other networks restart briefly to apply it.', 'info');
			window.setTimeout(() => location.reload(), 4000);
		});
		return rc.card({ icon: 'shield', title: 'Privacy on other networks', body: [
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'Appear on other networks as' ]), E('div', { 'class': 'cbi-value-field' }, [ sel ]) ]),
			E('p', { 'class': 'roam-muted roam-small' }, [
				'Routers that identify devices (by the way they ask for an address) see a Windows computer instead of an OpenWrt router. Minimal sends the least information, but its pattern is still recognizable.' ]),
			E('label', {}, [ box, ' Also tell them this router\'s hostname' ]),
			E('p', { 'class': 'roam-muted roam-small', 'style': 'margin-top:10px' }, [
				'Either way, no persistent ID is sent and time servers are generic. Also set the MAC address to Random or Custom under Internet \u203a Repeater.' ])
		], actions: [ E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, save) }, [ 'Save' ]) ] });
	},

	maintenanceCard() {
		return rc.card({ icon: 'gear', title: 'Maintenance', body: [
			E('p', { 'class': 'roam-muted' }, [ 'Restart the router, back up or restore settings, or install a new firmware image.' ])
		], actions: [
			E('button', { 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, () => {
				if (!confirm('Restart the router now? Wi-Fi and Internet will be down for about a minute.')) return;
				return callReboot().then(() => {
					ui.showModal('Restarting…', [ E('p', { 'class': 'spinning' }, [ 'The router is restarting. This page reconnects automatically.' ]) ]);
					window.setTimeout(() => ui.awaitReconnect(), 15000);
				});
			}) }, [ 'Restart' ]),
			E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/system/flash') }, [ 'Backup / Firmware' ]),
			E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/system/package-manager') }, [ 'Software' ])
		] });
	},

	render(data) {
		const zones = data[0];
		const m = new form.Map('system', null, null);
		const s = m.section(form.TypedSection, 'system', 'Device', null);
		s.anonymous = true;
		s.addremove = false;

		let o = s.option(form.Value, 'hostname', 'Hostname',
			'The router\'s own name (letters, digits and hyphens), shown in the sidebar and browser tab. Linux needs a name, so it cannot be blank, but it is not sent to other networks unless you allow it under Privacy below.');
		o.datatype = 'hostname';
		o.rmempty = false;

		o = s.option(form.ListValue, 'zonename', 'Time zone');
		o.value('UTC');
		Object.keys(zones).sort().forEach((z) => o.value(z));
		o.write = function(sid, v) {
			uci.set('system', sid, 'zonename', v);
			uci.set('system', sid, 'timezone', (zones[v] && zones[v].tzstring) || 'UTC');
		};

		return m.render().then((node) => E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Basic router settings. Click "Save & Apply" at the bottom after changing the hostname or time zone.' ]),
			node,
			E('div', { 'class': 'roam-grid' }, [ this.privacyCard(), this.passwordCard(), this.maintenanceCard() ])
		]));
	}
});
