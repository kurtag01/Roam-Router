'use strict';
'require view';
'require uci';
'require poll';
'require fs';
'require ui';
'require roam.common as rc';
'require roam.apps as apps';

/* Apps running next to the router on the Roam host (Raspberry Pi OS + Docker). */

const MORE = {
	games: [ 'Add games: copy ROM files into the matching system folder (games/library/roms/<system>, e.g. snes, gba, psx) on the Pi, then press "Scan" in RomM.',
	         'Controllers connect to the device you play on (USB or Bluetooth), not to the Pi.',
	         'First visit: RomM asks you to create its admin account.' ],
	plex: [ 'Put movies, shows and music in media/Movies, media/TV Shows and media/Music on the Pi.',
	        'Plex Media Server runs on the Pi: it holds your library and streams it to the Plex app on your phone, TV or laptop.',
	        'Link it to your Plex account once (button below), then add the libraries in Plex: Settings \u203a Libraries.' ]
};

return view.extend({
	load() {
		return uci.load('roam');
	},

	linkPlex() {
		const code = E('input', { 'type': 'text', 'class': 'cbi-input-text roam-mono', 'placeholder': 'claim-xxxxxxxxxxxxxxxxxxxx',
			'autocomplete': 'off', 'spellcheck': 'false', 'style': 'width:100%;box-sizing:border-box' });
		const err = E('div', { 'class': 'roam-drop-err', 'role': 'alert', 'style': 'display:none' });
		const btn = E('button', { 'class': 'btn cbi-button-action' }, [ 'Link server' ]);
		btn.addEventListener('click', () => {
			const v = code.value.trim();
			if (!/^claim-[A-Za-z0-9_-]{10,64}$/.test(v)) { err.textContent = 'Paste the whole code; it starts with "claim-".'; err.style.display = ''; return; }
			btn.disabled = true; btn.textContent = 'Linking…'; err.style.display = 'none';
			L.resolveDefault(fs.exec_direct('/usr/libexec/roam/plex-claim', [ v ], 'json'), { ok: false, error: 'The router could not run the link step.' }).then((r) => {
				if (r && r.ok) {
					ui.hideModal();
					ui.addNotification(null, E('p', {}, [ 'Plex is linked to your account. Open Plex and add your libraries (Settings \u203a Libraries).' ]), 'info');
					return this.refresh && this.refresh();
				}
				err.textContent = (r && r.error) || 'Linking failed.'; err.style.display = '';
				btn.disabled = false; btn.textContent = 'Link server';
			});
		});
		ui.showModal('Link Plex to your account', [
			E('p', { 'class': 'roam-muted' }, [ 'This makes you the owner of the Plex server on this router, so you can sign in to it from any Plex app. You only do this once.' ]),
			E('ol', { 'style': 'margin:0 0 14px 20px;padding:0;line-height:1.6' }, [
				E('li', {}, [ 'Open ', E('a', { 'href': 'https://plex.tv/claim', 'target': '_blank', 'rel': 'noopener' }, [ 'plex.tv/claim' ]), ' and sign in with your Plex account.' ]),
				E('li', {}, [ 'Copy the code it shows (it starts with "claim-" and is valid for 4 minutes).' ]),
				E('li', {}, [ 'Paste it here and click Link server.' ])
			]),
			code, err,
			E('div', { 'class': 'right', 'style': 'margin-top:14px' }, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, [ 'Cancel' ]), ' ', btn ])
		]);
		code.focus();
	},

	cards(st) {
		const ip = apps.hostIP();
		return E('div', { 'class': 'roam-grid' }, apps.APPS.map((a) => {
			const p = apps.pill(st, a.id);
			return rc.card({ icon: a.icon, title: a.title, off: !(st && st[a.id]), pill: p[0], pillClass: p[1],
				body: [
					E('p', { 'class': 'roam-muted' }, [ a.text ]),
					rc.kv([ [ 'Address', E('a', { 'href': a.url(), 'target': '_blank' }, [ a.url() ]) ],
						[ 'or', E('a', { 'href': a.alt(ip), 'target': '_blank', 'class': 'roam-mono' }, [ a.alt(ip) ]) ] ]),
					E('ul', { 'class': 'roam-muted roam-small', 'style': 'margin:12px 0 0 18px;padding:0;list-style:disc' }, (MORE[a.id] || []).map((t) => E('li', {}, [ t ])))
				],
				actions: [
					(a.id == 'plex' && st && st.plex && st.plex_claimed === false)
						? E('button', { 'class': 'btn cbi-button-action', 'click': () => this.linkPlex() }, [ 'Link your Plex account' ]) : '',
					E('a', { 'class': 'btn ' + ((a.id == 'plex' && st && st.plex_claimed === false) ? 'cbi-button' : 'cbi-button-action'), 'href': a.url(), 'target': '_blank' }, [ 'Open ' + a.title ])
				] });
		}));
	},

	render() {
		const holder = E('div', {}, [ this.cards(null) ]);
		const note = E('div', {});
		const check = () => apps.status().then((st) => {
			holder.replaceChildren(this.cards(st));
			note.replaceChildren(st && st.setup ? E('div', { 'class': 'alert-message notice' }, [
				'The Pi is still finishing its first start (' + st.setup + '). The apps come up on their own in a few minutes; the router already works.' ]) : '');
		});
		this.refresh = check;
		check();
		poll.add(check, 10);

		return E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Apps hosted on this router\'s Raspberry Pi (' + apps.hostIP() + '). They are only reachable from your own Wi-Fi and Ethernet, not from the hotel/home network or the guest Wi-Fi.' ]),
			note,
			holder
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
