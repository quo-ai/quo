'use strict';

const dns = require('node:dns');
const net = require('node:net');
const { WebError } = require('./errors');

/**
 * What a model may make Quo open. Only public web addresses: never this computer, a local network, or a
 * cloud provider's metadata address, however the address is written, and whichever address a name turns
 * into when the connection is made (so a name that points inside after the check is refused too).
 */

const BLOCKED = new net.BlockList();
for (const [address, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED.addSubnet(address, bits, 'ipv4');
for (const [address, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96], ['100::', 64]]) BLOCKED.addSubnet(address, bits, 'ipv6');

/** The IPv4 address inside an IPv4-mapped IPv6 one (::ffff:127.0.0.1, ::ffff:7f00:1), or null. */
function mapped(address) {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex) return null;
  const a = parseInt(hex[1], 16);
  const b = parseInt(hex[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

/** True for an address on the public internet. */
function isPublicAddress(input) {
  const address = String(input).replace(/%.*$/, '').replace(/^\[|\]$/g, '');
  const family = net.isIP(address);
  if (!family) return false;
  const v4 = family === 6 ? mapped(address) : address;
  return v4 ? !BLOCKED.check(v4, 'ipv4') : !BLOCKED.check(address, 'ipv6');
}

const PRIVATE = 'That address is on this computer or a private network, so Quo doesn’t open it.';

/** Checks an address the model gave: http or https, no credentials, and not an address inside. `allowPrivate` is for tests only. */
function parseWebUrl(input, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new WebError('bad_url', 'That isn’t a web address. It must start with http:// or https://.');
  }
  if (String(input).length > 2000) throw new WebError('bad_url', 'That address is too long.');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebError('bad_url', 'Only http:// and https:// addresses can be opened.');
  if (url.username || url.password) throw new WebError('bad_url', 'Addresses with a login in them aren’t opened.');
  if (!url.hostname) throw new WebError('bad_url', 'That address has no site in it.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && (net.isIP(host) ? !isPublicAddress(host) : /^localhost$|\.localhost$|\.local$|\.internal$/i.test(host))) throw new WebError('blocked', PRIVATE);
  url.hash = '';
  return url;
}

/** `dns.lookup` that refuses to connect to anything but public addresses: the check happens on the address actually used. */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) return callback(new WebError('blocked', PRIVATE));
    return options?.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
  });
}

/** The same address written one way, so "has this been seen" can compare. */
function normalizeUrl(input) {
  try {
    const url = new URL(String(input).trim());
    url.hash = '';
    return url.href;
  } catch {
    return String(input).trim();
  }
}

module.exports = { isPublicAddress, parseWebUrl, guardedLookup, normalizeUrl, PRIVATE };
