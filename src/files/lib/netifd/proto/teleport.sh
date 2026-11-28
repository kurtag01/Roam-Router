#!/bin/sh
# netifd protocol "teleport": UniFi Teleport client (experimental).
#
# Runs teleport-client (patched for Roam: kernel TUN "teleport", marked sockets) through
# /usr/libexec/roam/teleport. The client calls /lib/netifd/teleport-hook when the tunnel
# comes up; the hook sets addresses, routes and rules and reports to netifd.
#
#   config interface 'teleport'
#       option proto 'teleport'
#       option invite 'https://teleport.ui.link/<uuid>'   # only until paired
#       option client_name 'Roam'                          # shown in UniFi
#       option mtu '1380'                                  # optional; default: probed
#
# Pairing saves a session in /etc/teleport/session.json (kept across updates); later
# starts reconnect with it.

[ -n "$INCLUDE_ONLY" ] || {
	. /lib/functions.sh
	. ../netifd-proto.sh
	init_proto "$@"
}

proto_teleport_init_config() {
	no_device=1
	available=1
	proto_config_add_string "invite"
	proto_config_add_string "client_name"
	proto_config_add_int "mtu"
}

proto_teleport_setup() {
	local config="$1"
	local invite client_name mtu
	json_get_vars invite client_name mtu

	local sess=/etc/teleport/session.json
	mkdir -p /etc/teleport && chmod 700 /etc/teleport
	set --
	if [ -s "$sess" ]; then
		set -- --session-file "$sess"
	elif [ -n "$invite" ]; then
		set -- --invite "$invite" --session-file "$sess"
	else
		echo "teleport: no invite link and no saved session" | logger -t teleport
		proto_notify_error "$config" NO_INVITE
		proto_block_restart "$config"
		return 1
	fi
	[ -n "$mtu" ] && set -- "$@" --mtu "$mtu"
	# The client resolves its own hostnames (Teleport API, STUN) outside the tunnel: the
	# router's resolver forwards into the tunnel, which is down while it negotiates.
	# Kill switch on: the one DNS server it lets through. Otherwise: the uplink's DNS
	# (works behind hotel portals), or Quad9.
	local dns="" i
	[ "$(uci -q get roam.main.killswitch)" = 1 ] && dns=$(uci -q get roam.main.ks_boot_dns)
	if [ -z "$dns" ]; then
		for i in $(ubus call network.interface dump 2>/dev/null | jsonfilter -e '@.interface[@.up=true].interface'); do
			case "$i" in "$config"|wgclient|loopback|lan|guest) continue ;; esac
			dns=$(ifstatus "$i" | jsonfilter -e '@["dns-server"][0]' 2>/dev/null)
			case "$dns" in ''|*:*) dns="" ;; *) break ;; esac
		done
	fi
	set -- "$@" --dns "${dns:-149.112.112.112}"

	proto_run_command "$config" /usr/libexec/roam/teleport run "$config" \
		--tun teleport --fwmark 0x5450 \
		--hook /lib/netifd/teleport-hook --status /var/run/teleport.json \
		--name "${client_name:-Roam travel router}" "$@"
}

proto_teleport_teardown() {
	local config="$1"
	proto_kill_command "$config"
	TELEPORT_INTERFACE="$config" /lib/netifd/teleport-hook down
}

[ -n "$INCLUDE_ONLY" ] || add_protocol teleport
