import { Client as SsdpClient } from 'node-ssdp';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import { config } from '../config.js';

/**
 * UPNP.JS — UPnP/DLNA 家庭音响推流
 *
 * 使用 SSDP 扫描局域网 DLNA 设备（MediaRenderer），
 * 通过 AVTransport SOAP 控制播放。
 * 断联时自动降级到 local 播放。
 */
export class UPnPModule {
  #devices = new Map();  // descUrl → DeviceInfo

  /**
   * 扫描局域网 UPnP/DLNA 设备
   * @returns {Promise<DeviceInfo[]>}
   */
  async scan() {
    return new Promise((resolve) => {
      const client = new SsdpClient();
      const found = new Map();

      client.on('response', async (headers) => {
        const loc = headers.LOCATION || headers.location;
        if (!loc || found.has(loc)) return;
        found.set(loc, true);

        try {
          const info = await this.#fetchDeviceInfo(loc);
          if (info) {
            this.#devices.set(loc, info);
          }
        } catch { /* 忽略单个设备解析失败 */ }
      });

      client.search('urn:schemas-upnp-org:device:MediaRenderer:1');

      setTimeout(() => {
        client.stop();
        resolve([...this.#devices.values()]);
      }, config.upnp.scanTimeoutMs);
    });
  }

  get knownDevices() {
    return [...this.#devices.values()];
  }

  /**
   * 推送 URL 到指定设备播放
   * @param {string} deviceDescUrl  设备描述 URL
   * @param {string} mediaUrl       要播放的媒体 URL
   */
  async playUrl(deviceDescUrl, mediaUrl) {
    const device = this.#devices.get(deviceDescUrl);
    if (!device) throw new Error(`UPnP device not found: ${deviceDescUrl}`);

    await this.#avTransport(device.avTransportUrl, 'SetAVTransportURI', `
      <InstanceID>0</InstanceID>
      <CurrentURI>${this.#escapeXml(mediaUrl)}</CurrentURI>
      <CurrentURIMetaData></CurrentURIMetaData>
    `);
    await this.#avTransport(device.avTransportUrl, 'Play', `
      <InstanceID>0</InstanceID>
      <Speed>1</Speed>
    `);
  }

  async stop(deviceDescUrl) {
    const device = this.#devices.get(deviceDescUrl);
    if (!device) return;
    await this.#avTransport(device.avTransportUrl, 'Stop', '<InstanceID>0</InstanceID>').catch(() => {});
  }

  async setVolume(deviceDescUrl, level) {
    const device = this.#devices.get(deviceDescUrl);
    if (!device || !device.renderingControlUrl) return;
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    await this.#soap(
      device.renderingControlUrl,
      'urn:schemas-upnp-org:service:RenderingControl:1',
      'SetVolume',
      `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${clamped}</DesiredVolume>`
    ).catch(() => {});
  }

  // ── private ───────────────────────────────────────────────────────────────

  async #fetchDeviceInfo(descUrl) {
    const res = await fetch(descUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const xml = await res.text();
    const doc = await parseStringPromise(xml, { explicitArray: false });

    const device = doc?.root?.device;
    if (!device) return null;

    const friendlyName = device.friendlyName ?? 'Unknown Device';
    const baseUrl = new URL(descUrl).origin;

    // 找 AVTransport 和 RenderingControl 服务的 controlURL
    const services = [].concat(device.serviceList?.service ?? []);
    const avSvc  = services.find((s) => String(s.serviceType).includes('AVTransport'));
    const rcSvc  = services.find((s) => String(s.serviceType).includes('RenderingControl'));

    if (!avSvc) return null;

    return {
      descUrl,
      friendlyName,
      avTransportUrl:       baseUrl + avSvc.controlURL,
      renderingControlUrl:  rcSvc ? baseUrl + rcSvc.controlURL : null,
    };
  }

  async #avTransport(controlUrl, action, bodyInner) {
    return this.#soap(controlUrl, 'urn:schemas-upnp-org:service:AVTransport:1', action, bodyInner);
  }

  async #soap(controlUrl, serviceType, action, bodyInner) {
    const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${bodyInner}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

    const res = await fetch(controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${serviceType}#${action}"`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`SOAP ${action} failed: ${res.status}`);
    return res.text();
  }

  #escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

/**
 * @typedef {{ descUrl: string, friendlyName: string, avTransportUrl: string, renderingControlUrl: string|null }} DeviceInfo
 */
