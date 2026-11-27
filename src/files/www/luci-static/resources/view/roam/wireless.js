'use strict';
'require view';
'require network';
'require uci';
'require ui';
'require roam.common as rc';

/* Broadcast networks (main + guest), their MAC addresses (BSSID), and which radio
   does what (broadcasting vs. connecting to the Internet). */

const SECURITY = [
	[ 'psk2', 'WPA2-Personal (most compatible)' ],
	[ 'sae-mixed', 'WPA2/WPA3-Personal' ],
	[ 'sae', 'WPA3-Personal (most secure)' ],
	[ 'none', 'Open (no password)' ]
];
/* Broadcast power for the radio that carries My Wi-Fi + Guest Wi-Fi (uci txpower, dBm).
   High = no limit: the radio's maximum allowed for the country (usually ~20 dBm). */
const POWER = [
	[ 'high', 'High (strongest signal, best range)', null ],
	[ 'medium', 'Medium (about half the range)', '14' ],
	[ 'low', 'Low (about one room)', '8' ]
];
function powerLevel(txpower) {
	if (txpower == null || txpower === '') return 'high';
	const p = POWER.filter((x) => x[2] == String(txpower))[0];
	return p ? p[0] : 'custom';
}

const CHANNELS = {
	'2g': [ 'auto', '1', '6', '11' ],
	'5g': [ 'auto', '36', '40', '44', '48', '149', '153', '157', '161', '165' ],
	'6g': [ 'auto', '5', '21', '37', '53', '69', '85' ]
};

function sel(options, value) {
	const s = E('select', {}, options.map((o) => E('option', { 'value': o[0] }, [ o[1] ])));
	s.value = value;
	if (s.value != value && value != null) { s.appendChild(E('option', { 'value': value }, [ value ])); s.value = value; }
	return s;
}
function field(label, el, help) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, [ label ]),
		E('div', { 'class': 'cbi-value-field' }, [ el, help ? E('div', { 'class': 'cbi-value-description' }, [ help ]) : '' ])
	]);
}

return view.extend({
	load() {
		return Promise.all([
			uci.load([ 'wireless', 'roam' ]),
			network.getWifiDevices(),
			network.getWifiNetworks()
		]);
	},

	ssidCard(sid, title, icon, wifis) {
		const s = uci.get('wireless', sid);
		if (!s) return '';
		const w = wifis.filter((x) => x.getName() == sid)[0];
		const enabled = s.disabled != '1';
		const live = w && w.isUp() ? w.getActiveBSSID() : null;

		const on = E('input', { 'type': 'checkbox', 'checked': enabled ? '' : null });
		const ssid = E('input', { 'type': 'text', 'value': s.ssid || '', 'maxlength': 32 });
		const enc = sel(SECURITY, s.encryption || 'psk2');
		const key = E('input', { 'type': 'password', 'value': s.key || '', 'autocomplete': 'new-password' });
		const show = E('label', { 'class': 'roam-small' }, [ E('input', { 'type': 'checkbox', 'change': (ev) => { key.type = ev.target.checked ? 'text' : 'password'; } }), ' Show' ]);
		const hidden = E('input', { 'type': 'checkbox', 'checked': s.hidden == '1' ? '' : null });
		const mac = rc.macEditor(s.macaddr || '', (!s.macaddr && live) ? live : null, null);

		const keyField = field('Password', E('div', {}, [ key, ' ', show ]));
		const syncEnc = () => { keyField.style.display = (enc.value == 'none') ? 'none' : ''; };
		enc.addEventListener('change', syncEnc); syncEnc();

		const save = () => {
			if (!ssid.value || ssid.value.length > 32) return rc.note('The network name must be 1 to 32 characters.', 'warning');
			if (enc.value != 'none' && (key.value.length < 8 || key.value.length > 63)) return rc.note('The Wi-Fi password must be 8 to 63 characters.', 'warning');
			let m;
			try { m = mac.getValue(); } catch (e) { return rc.note(e.message, 'warning'); }

			uci.set('wireless', sid, 'disabled', on.checked ? '0' : '1');
			uci.set('wireless', sid, 'ssid', ssid.value);
			uci.set('wireless', sid, 'encryption', enc.value);
			if (enc.value == 'none') uci.unset('wireless', sid, 'key'); else uci.set('wireless', sid, 'key', key.value);
			if (enc.value == 'sae' || enc.value == 'sae-mixed') uci.set('wireless', sid, 'ieee80211w', enc.value == 'sae' ? '2' : '1');
			else uci.unset('wireless', sid, 'ieee80211w');
			if (hidden.checked) uci.set('wireless', sid, 'hidden', '1'); else uci.unset('wireless', sid, 'hidden');
			if (m) uci.set('wireless', sid, 'macaddr', m); else uci.unset('wireless', sid, 'macaddr');
			return (m != (s.macaddr || '')) ? rc.applyMac(sid, m) : rc.apply();
		};

		return rc.card({ icon: icon, title: title, off: !enabled,
			pill: !enabled ? 'Off' : (w && w.isUp() ? 'Broadcasting' : 'Starting'), pillClass: !enabled ? '' : (w && w.isUp() ? 'ok' : 'warn'),
			body: [
				field('Enabled', E('label', {}, [ on, ' Broadcast this network' ])),
				field('Network name', ssid),
				field('Security', enc),
				keyField,
				field('Hidden', E('label', {}, [ hidden, ' Don\'t show the name in network lists' ])),
				sid == 'guest' ? E('p', { 'class': 'roam-muted roam-small' }, [ 'Guests get Internet access only: they cannot see each other, your devices, or this router\'s settings.' ]) : '',
				E('div', { 'class': 'roam-section-title' }, [ 'MAC address (BSSID)' ]),
				live ? E('p', { 'class': 'roam-small roam-muted' }, [ 'Currently broadcasting as ', E('span', { 'class': 'roam-mono' }, [ live ]) ]) : '',
				mac.node
			],
			actions: [ E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, save) }, [ 'Save' ]) ]
		});
	},

	radiosCard(radios, wifis) {
		if (!radios.length)
			return rc.card({ icon: 'radio', title: 'Radios', off: true, pill: 'None found', pillClass: 'bad',
				body: [ E('p', { 'class': 'roam-muted' }, [ 'No Wi-Fi hardware detected. Check that the USB adapter is plugged in, then reboot.' ]) ] });

		const opts = radios.map((r) => [ r.getName(), r.getName() + ' – ' + r.getI18n() ]);
		const apSel = sel(opts, uci.get('wireless', 'ap', 'device') || opts[0][0]);
		const staSel = sel(opts, uci.get('wireless', 'wwan', 'device') || opts[0][0]);
		const apRadio = apSel.value;
		const curTx = uci.get('wireless', apRadio, 'txpower');
		const level = powerLevel(curTx);
		const powerOpts = POWER.map((p) => [ p[0], p[1] ]);
		if (level == 'custom') powerOpts.push([ 'custom', 'Custom (' + curTx + ' dBm, set under Advanced Settings)' ]);
		const powerSel = sel(powerOpts, level);
		const apWifi = (wifis || []).filter((w) => w.getName() == 'ap')[0];
		const nowDbm = apWifi && apWifi.isUp() ? apWifi.getTXPower() : null;
		const nowText = nowDbm != null
			? 'Right now the radio reports ' + nowDbm + ' dBm (' + Math.round(Math.pow(10, nowDbm / 10)) + ' mW).' : '';

		const rows = radios.map((r) => {
			const n = r.getName();
			const band = uci.get('wireless', n, 'band') || '2g';
			const ch = sel((CHANNELS[band] || [ 'auto' ]).map((c) => [ c, c == 'auto' ? 'Automatic' : 'Channel ' + c ]), uci.get('wireless', n, 'channel') || 'auto');
			const cc = E('input', { 'type': 'text', 'maxlength': 2, 'style': 'width:4em;text-transform:uppercase', 'value': uci.get('wireless', n, 'country') || '' });
			ch.setAttribute('data-radio', n); cc.setAttribute('data-radio', n);
			ch.classList.add('roam-ch'); cc.classList.add('roam-cc');
			return E('tr', {}, [
				E('td', { 'data-title': 'Radio' }, [ E('strong', {}, [ n ]), E('div', { 'class': 'roam-small roam-muted' }, [ r.getI18n() ]) ]),
				E('td', { 'data-title': 'Band' }, [ band.toUpperCase().replace('G', ' GHz') ]),
				E('td', { 'data-title': 'Channel' }, [ ch ]),
				E('td', { 'data-title': 'Country' }, [ cc ]),
				E('td', { 'data-title': 'Status' }, [ E('span', { 'class': 'roam-pill ' + (r.isUp() ? 'ok' : '') }, [ r.isUp() ? 'Up' : 'Down' ]) ])
			]);
		});
		const table = E('table', { 'class': 'roam-table' }, [
			E('thead', {}, [ E('tr', {}, [ 'Radio', 'Band', 'Channel', 'Country', 'Status' ].map((h) => E('th', {}, [ h ]))) ]),
			E('tbody', {}, rows)
		]);

		const save = () => {
			let bad = false;
			table.querySelectorAll('.roam-cc').forEach((i) => {
				const v = i.value.trim().toUpperCase();
				if (v && !/^[A-Z0-9]{2}$/.test(v)) bad = true;
				else if (v) uci.set('wireless', i.getAttribute('data-radio'), 'country', v);
			});
			if (bad) return rc.note('Country codes are two letters, for example US, CA, GB, DE.', 'warning');
			table.querySelectorAll('.roam-ch').forEach((s) => uci.set('wireless', s.getAttribute('data-radio'), 'channel', s.value));

			const ap = apSel.value, sta = staSel.value;
			/* Broadcast power goes with the broadcasting radio; a radio that no longer
			   broadcasts goes back to full power (unless it was a custom value). */
			const pw = POWER.filter((p) => p[0] == powerSel.value)[0];
			if (pw) {
				if (pw[2]) uci.set('wireless', ap, 'txpower', pw[2]); else uci.unset('wireless', ap, 'txpower');
			}
			const oldAp = uci.get('wireless', 'ap', 'device');
			if (oldAp && oldAp != ap && powerLevel(uci.get('wireless', oldAp, 'txpower')) != 'custom')
				uci.unset('wireless', oldAp, 'txpower');
			[ 'ap', 'guest' ].forEach((x) => { if (uci.get('wireless', x)) uci.set('wireless', x, 'device', ap); });
			if (uci.get('wireless', 'wwan')) uci.set('wireless', 'wwan', 'device', sta);
			[ ap, sta ].forEach((r) => uci.set('wireless', r, 'disabled', '0'));
			uci.set('roam', 'main', 'ap_radio', ap);
			uci.set('roam', 'main', 'sta_radio', sta);
			return rc.apply();
		};

		return rc.card({ icon: 'radio', title: 'Radios', cls: 'roam-wide', body: [
			table,
			E('div', { 'class': 'roam-section-title' }, [ 'Roles' ]),
			field('Broadcast my Wi-Fi with', apSel, 'The radio your phones and laptops connect to.'),
			field('Broadcast power', powerSel, E('span', {}, [
				'How far My Wi-Fi and Guest Wi-Fi reach. Lower power keeps the networks from being seen (and attacked) far outside your room, and uses less energy; High gives the best range and speed at a distance.',
				nowText ? E('br') : '', nowText ])),
			field('Connect to Internet with', staSel, 'The radio used by the Repeater to join hotel/home Wi-Fi. Using a different radio than above gives the best speed.'),
			E('p', { 'class': 'roam-muted roam-small' }, [ 'If both roles use the same radio, your Wi-Fi follows the channel of the network you are connected to, and the broadcast power also applies to the connection to the Internet.' ])
		], actions: [ E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, save) }, [ 'Save radios' ]) ] });
	},

	render(data) {
		const radios = data[1], wifis = data[2];
		return E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'The Wi-Fi networks this router broadcasts for your devices. To connect the router itself to a Wi-Fi network, use Internet › Repeater.' ]),
			E('div', { 'class': 'roam-grid' }, [
				this.ssidCard('ap', 'My Wi-Fi', 'wifi', wifis),
				this.ssidCard('guest', 'Guest Wi-Fi', 'guest', wifis)
			]),
			this.radiosCard(radios, wifis)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
