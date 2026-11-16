import os from 'node:os';

export interface LocalAddress {
  address: string;
  interface: string;
  preferred: boolean;
}

const VIRTUAL = /(vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|hamachi|vpn|tap|tun)/i;

/** Lista os IPv4 da máquina, priorizando placas reais (Wi-Fi/Ethernet). */
export function getLocalAddresses(): LocalAddress[] {
  const result: LocalAddress[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue; // APIPA (sem DHCP)
      result.push({ address: info.address, interface: name, preferred: !VIRTUAL.test(name) });
    }
  }
  const score = (a: LocalAddress) =>
    (a.preferred ? 0 : 10) +
    (/wi-?fi|wlan|wireless/i.test(a.interface) ? 0 : 1) +
    (a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : 2);
  return result.sort((a, b) => score(a) - score(b));
}

export function pickLocalIp(preferred?: string): string {
  const list = getLocalAddresses();
  if (preferred && list.some((a) => a.address === preferred)) return preferred;
  return list[0]?.address || '127.0.0.1';
}
