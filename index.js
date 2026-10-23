// @ts-nocheck
import { connect } from "cloudflare:sockets";
import init, { parseStreamFrame } from "./pkg/zr_wasm.js";
import wasm from "./pkg/zr_wasm_bg.wasm";
import panelHtml from "./index.html";

let wasmReady = null;
async function ensureWasm() {
  if (!wasmReady) {
    wasmReady = init(wasm).catch((err) => {
      wasmReady = null;
      throw err;
    });
  }
  return wasmReady;
}

const decodeSecure = (encoded) => atob(encoded);

const CONST = {
  ED_PARAMS: { ed: 2560, eh: "Sec-WebSocket-Protocol" },
  AT_SYMBOL: "@",
  VLESS_PROTOCOL: decodeSecure("dmxlc3M="),
  WS_READY_STATE_OPEN: 1,
  WS_READY_STATE_CLOSING: 2,
};

function createDecoyResponse() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Service Operational</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #94a3b8; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .status-card { background: #1e293b; border-radius: 8px; padding: 2rem; max-width: 420px; width: 90%; text-align: center; border: 1px solid #334155; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; color: #38bdf8; font-weight: 600; }
    p { font-size: 0.875rem; margin: 0; }
  </style>
</head>
<body>
  <div class="status-card">
    <h1>Service Operational</h1>
    <p>The edge service gateway is operating normally.</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function safeFetch(url, options = {}, timeout = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function parseProxyEndpoint(endpoint) {
  if (!endpoint) return null;
  const str = endpoint.trim();
  if (!str) return null;
  if (str.startsWith("[")) {
    const closeBracket = str.indexOf("]");
    if (closeBracket !== -1) {
      const host = str.slice(1, closeBracket);
      const rest = str.slice(closeBracket + 1);
      const port = rest.startsWith(":") ? Number(rest.slice(1)) || 443 : 443;
      return { host, port, address: `${str}` };
    }
  }
  const parts = str.split(":");
  const host = parts[0].trim();
  if (!host) return null;
  const port = parts[1] ? Number(parts[1]) || 443 : 443;
  return { host, port, address: `${host}:${port}` };
}

const Config = {
  fromEnv(env) {
    let proxyList = [];
    if (env && env.PROXYIP) {
      proxyList = env.PROXYIP.split(",")
        .map((s) => parseProxyEndpoint(s))
        .filter(Boolean);
    }

    const selected =
      proxyList.length > 0
        ? proxyList[Math.floor(Math.random() * proxyList.length)]
        : null;

    const rawUUID = (env && env.UUID ? env.UUID : "").trim();
    const userIDs = rawUUID
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    return {
      userID: rawUUID,
      userIDs,
      primaryUserID: userIDs[0] || "",
      proxyIP: selected?.host || "",
      proxyPort: selected?.port || 443,
      proxyAddress: selected?.address || (proxyList[0]?.address || ""),
      proxyList,
    };
  },
};

function generateRandomPath(length = 28, query = "") {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `/${result}${query ? `?${query}` : ""}`;
}

const CORE_PRESETS = {
  xray: {
    tls: {
      path: () => generateRandomPath(12, "ed=2048"),
      security: "tls",
      fp: "chrome",
      alpn: "http/1.1",
      extra: {},
    },
    tcp: {
      path: () => generateRandomPath(12, "ed=2560"),
      security: "none",
      fp: "chrome",
      extra: {},
    },
  },
  sb: {
    tls: {
      path: () => generateRandomPath(18),
      security: "tls",
      fp: "chrome",
      alpn: "http/1.1",
      extra: CONST.ED_PARAMS,
    },
    tcp: {
      path: () => generateRandomPath(18),
      security: "none",
      fp: "chrome",
      extra: CONST.ED_PARAMS,
    },
  },
};

function makeName(tag, proto) {
  return `${tag}-${proto.toUpperCase()}`;
}

function createVlessLink({
  userID,
  address,
  port,
  host,
  path,
  security,
  sni,
  fp,
  alpn,
  extra = {},
  name,
}) {
  const params = new URLSearchParams({ type: decodeSecure("d3M="), host, path });
  if (security) {
    params.set("security", security);
  }
  if (sni) params.set("sni", sni);
  if (fp) params.set("fp", fp);
  if (alpn) params.set("alpn", alpn);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `${CONST.VLESS_PROTOCOL}://${userID}@${address}:${port}?${params.toString()}#${encodeURIComponent(name)}`;
}

function buildLink({ core, proto, userID, hostName, address, port, tag }) {
  const p = CORE_PRESETS[core][proto];
  return createVlessLink({
    userID,
    address,
    port,
    host: hostName,
    path: p.path(),
    security: p.security,
    sni: p.security === "tls" ? hostName : undefined,
    fp: p.fp,
    alpn: p.alpn,
    extra: p.extra,
    name: makeName(tag, proto),
  });
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function handleIpSubscription(request, core, userID, hostName, ctx, env) {
  const url = new URL(request.url);
  const subName = url.searchParams.get("name");
  const CAKE_INFO = {
    total_TB: 380,
    base_GB: 42000,
    daily_growth_GB: 250,
    expire_date: "2038-4-20",
  };

  const defaultDomains = [
    hostName,
    "www.speedtest.net",
    "chatgpt.com",
    "creativecommons.org",
    "www.visa.com",
  ];

  let customClean = [];
  if (env && env.CLEAN_IPS) {
    customClean = env.CLEAN_IPS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const mainDomains = Array.from(new Set([...defaultDomains, ...customClean]));
  const httpsPorts = [443, 8443, 2053, 2083, 2087, 2096];
  const httpPorts = [80, 8080, 8880, 2052, 2082, 2086, 2095];
  let links = [];
  const isPagesDeployment = hostName.endsWith(".pages.dev");

  mainDomains.forEach((domain, i) => {
    let host = domain;
    let customHttpsPort = null;
    let customHttpPort = null;

    if (domain.includes(":") && !domain.startsWith("[")) {
      const parts = domain.split(":");
      host = parts[0];
      const p = Number(parts[1]);
      if (p) {
        customHttpsPort = p;
        customHttpPort = p;
      }
    } else if (domain.startsWith("[") && domain.includes("]:")) {
      const parts = domain.split("]:");
      host = parts[0] + "]";
      const p = Number(parts[1]);
      if (p) {
        customHttpsPort = p;
        customHttpPort = p;
      }
    }

    links.push(
      buildLink({
        core,
        proto: "tls",
        userID,
        hostName,
        address: host,
        port: customHttpsPort || pick(httpsPorts),
        tag: `Node${i + 1}`,
      }),
    );
    if (!isPagesDeployment) {
      links.push(
        buildLink({
          core,
          proto: "tcp",
          userID,
          hostName,
          address: host,
          port: customHttpPort || pick(httpPorts),
          tag: `Node${i + 1}`,
        }),
      );
    }
  });

  const GB_in_bytes = 1024 * 1024 * 1024;
  const TB_in_bytes = 1024 * GB_in_bytes;
  const total_bytes = CAKE_INFO.total_TB * TB_in_bytes;
  const base_bytes = CAKE_INFO.base_GB * GB_in_bytes;
  const now = new Date();
  const hours_passed = now.getHours() + now.getMinutes() / 60;
  const daily_growth_bytes = (hours_passed / 24) * (CAKE_INFO.daily_growth_GB * GB_in_bytes);
  const cake_download = base_bytes + daily_growth_bytes / 2;
  const cake_upload = base_bytes + daily_growth_bytes / 2;
  const expire_timestamp = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60;
  const subInfo = `upload=${Math.round(cake_upload)}; download=${Math.round(cake_download)}; total=${total_bytes}; expire=${expire_timestamp}`;

  const headers = {
    "Content-Type": "text/plain;charset=utf-8",
    "Profile-Update-Interval": "8",
    "Subscription-Userinfo": subInfo,
  };
  if (subName) headers["Profile-Title"] = subName;
  return new Response(btoa(links.join("\n")), { headers });
}

async function ProtocolOverWSHandler(request, config) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  webSocket.accept();

  let address = "";
  let portWithRandomLog = "";
  let udpStreamWriter = null;

  const log = (info, event) => {
    // Suppress verbose operational logs in production
  };

  const earlyDataHeader = request.headers.get("Sec-WebSocket-Protocol") || "";
  const readableWebSocketStream = MakeReadableWebSocketStream(webSocket, earlyDataHeader, log);
  let remoteSocketWrapper = { value: null };

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          try {
            if (udpStreamWriter) {
              await udpStreamWriter(chunk);
              return;
            }

            if (remoteSocketWrapper.value) {
              const writer = remoteSocketWrapper.value.writable.getWriter();
              await writer.write(chunk);
              writer.releaseLock();
              return;
            }

            const header = parseStreamFrame(new Uint8Array(chunk), config.userID);
            if (header.has_error) {
              safeCloseWebSocket(webSocket);
              return;
            }

            address = header.address_remote;
            portWithRandomLog = `${header.port_remote}--${Math.random()} ${header.is_udp ? "udp" : "tcp"} `;

            const vlessResponseHeader = new Uint8Array([header.version, 0]);
            const rawClientData = chunk.slice(header.raw_data_index);

            if (header.is_udp) {
              if (header.port_remote === 53) {
                const dnsPipeline = await createDnsPipeline(webSocket, vlessResponseHeader, log);
                udpStreamWriter = dnsPipeline.write;
                await udpStreamWriter(rawClientData);
              } else {
                safeCloseWebSocket(webSocket);
              }
              return;
            }

            await HandleTCPOutBound(
              remoteSocketWrapper,
              header.address_remote,
              header.port_remote,
              rawClientData,
              webSocket,
              vlessResponseHeader,
              log,
              config,
            );
          } catch (err) {
            safeCloseWebSocket(webSocket);
          }
        },
        close() {
          log(`readableWebSocketStream closed`);
        },
        abort(err) {
          log(`readableWebSocketStream aborted`, err);
          safeCloseWebSocket(webSocket);
        },
      }),
    )
    .catch((err) => {
      safeCloseWebSocket(webSocket);
    });

  return new Response(null, { status: 101, webSocket: client });
}

async function HandleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  protocolResponseHeader,
  log,
  config,
) {
  async function connectAndWrite(address, port) {
    const safeHost =
      address.includes(":") && !address.startsWith("[")
        ? `[${address}]`
        : address;

    const tcpSocket = connect({ hostname: safeHost, port: Number(port) });
    remoteSocket.value = tcpSocket;
    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();
    return tcpSocket;
  }

  async function retry() {
    const fallbacks =
      config.proxyList && config.proxyList.length > 0
        ? config.proxyList
        : config.proxyIP
          ? [{ host: config.proxyIP, port: config.proxyPort || portRemote }]
          : [];

    for (const proxy of fallbacks) {
      try {
        const tcpSocket = await connectAndWrite(proxy.host, proxy.port);
        tcpSocket.closed
          .catch(() => {})
          .finally(() => safeCloseWebSocket(webSocket));

        RemoteSocketToWS(tcpSocket, webSocket, protocolResponseHeader, null, log)
          .catch(() => safeCloseWebSocket(webSocket));
        return;
      } catch (err) {
        // Continue to next fallback in pool
      }
    }

    safeCloseWebSocket(webSocket);
  }

  try {
    const tcpSocket = await connectAndWrite(addressRemote, portRemote);
    tcpSocket.closed
      .catch(() => {})
      .finally(() => safeCloseWebSocket(webSocket));

    RemoteSocketToWS(tcpSocket, webSocket, protocolResponseHeader, retry, log)
      .catch(() => safeCloseWebSocket(webSocket));
  } catch (err) {
    try {
      await retry();
    } catch (retryErr) {
      safeCloseWebSocket(webSocket);
    }
  }
}

function MakeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  return new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        try {
          controller.enqueue(event.data);
        } catch (e) {}
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        try {
          controller.close();
        } catch (e) {}
      });
      webSocketServer.addEventListener("error", (err) => {
        try {
          controller.error(err);
        } catch (e) {}
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        try {
          controller.error(error);
        } catch (e) {}
      } else if (earlyData) {
        try {
          controller.enqueue(earlyData);
        } catch (e) {}
      }
    },
    pull(_controller) {},
    cancel(reason) {
      safeCloseWebSocket(webSocketServer);
    },
  });
}

async function RemoteSocketToWS(remoteSocket, webSocket, protocolResponseHeader, retry, log) {
  let hasIncomingData = false;
  try {
    await remoteSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState !== CONST.WS_READY_STATE_OPEN) {
            return;
          }
          hasIncomingData = true;
          const dataToSend = protocolResponseHeader
            ? await new Blob([protocolResponseHeader, chunk]).arrayBuffer()
            : chunk;
          try {
            webSocket.send(dataToSend);
          } catch (sendErr) {
            return;
          }
          protocolResponseHeader = null;
        },
        close() {},
        abort(reason) {},
      }),
    );
  } catch (error) {
    safeCloseWebSocket(webSocket);
  }

  if (!hasIncomingData && retry) {
    try {
      await retry();
    } catch (err) {
      safeCloseWebSocket(webSocket);
    }
  }

  return hasIncomingData;
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { earlyData: null, error: null };
  try {
    const binaryStr = atob(base64Str.replace(/-/g, "+").replace(/_/g, "/"));
    const buffer = new ArrayBuffer(binaryStr.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binaryStr.length; i++) view[i] = binaryStr.charCodeAt(i);
    return { earlyData: buffer, error: null };
  } catch (error) {
    return { earlyData: null, error };
  }
}

function safeCloseWebSocket(socket) {
  try {
    if (
      socket &&
      (socket.readyState === CONST.WS_READY_STATE_OPEN ||
        socket.readyState === CONST.WS_READY_STATE_CLOSING)
    ) {
      socket.close();
    }
  } catch (error) {}
}

async function createDnsPipeline(webSocket, vlessResponseHeader, log) {
  let isHeaderSent = false;
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength; ) {
        if (index + 2 > chunk.byteLength) break;
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPacketLength = new DataView(lengthBuffer).getUint16(0);
        if (index + 2 + udpPacketLength > chunk.byteLength) break;
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPacketLength));
        index = index + 2 + udpPacketLength;
        controller.enqueue(udpData);
      }
    },
  });

  transformStream.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          try {
            const resp = await safeFetch(
              `https://1.1.1.1/dns-query`,
              {
                method: "POST",
                headers: { "content-type": "application/dns-message" },
                body: chunk,
              },
              4000,
            );
            if (!resp.ok) return;
            const dnsQueryResult = await resp.arrayBuffer();
            const udpSize = dnsQueryResult.byteLength;
            const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);

            if (webSocket.readyState === CONST.WS_READY_STATE_OPEN) {
              if (isHeaderSent) {
                webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
              } else {
                webSocket.send(
                  await new Blob([
                    vlessResponseHeader,
                    udpSizeBuffer,
                    dnsQueryResult,
                  ]).arrayBuffer(),
                );
                isHeaderSent = true;
              }
            }
          } catch (error) {}
        },
      }),
    )
    .catch(() => {});

  const writer = transformStream.writable.getWriter();
  return {
    write: async (chunk) => {
      try {
        await writer.write(chunk);
      } catch (e) {}
    },
  };
}

async function handleMyConnection(request, env, ctx) {
  const clientIP = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const cf = request.cf || {};

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  return new Response(
    JSON.stringify({
      ip: clientIP,
      country: cf.country || "N/A",
      city: cf.city || "",
      isp: cf.asOrganization || "N/A",
      threatScore: 0,
      risk: "Low",
    }),
    { headers },
  );
}

async function handleResolveDomain(request) {
  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  if (!domain) {
    return new Response(JSON.stringify({ error: "Missing domain" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
    return new Response(JSON.stringify({ ip: domain }), { headers });
  }

  try {
    const dnsRes = await safeFetch(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      {
        headers: { accept: "application/dns-json" },
      },
      4000,
    );
    if (!dnsRes.ok) throw new Error(`DNS query failed with status: ${dnsRes.status}`);
    const dnsData = await dnsRes.json();
    const ipAnswer = dnsData.Answer?.find((a) => a.type === 1);
    return new Response(JSON.stringify({ ip: ipAnswer ? ipAnswer.data : null }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ip: null, error: error.toString() }), { headers });
  }
}

async function handleConfigPage(userID, hostName, proxyAddress) {
  const dream = buildLink({
    core: "xray",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: `${hostName}-Xray`,
  });
  const freedom = buildLink({
    core: "sb",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: `${hostName}-Singbox`,
  });
  const encodedSubName = encodeURIComponent("INDEX");
  const subXrayUrlH = `https://${hostName}/xray/${userID}?name=${encodedSubName}`;
  const subXrayUrlV = `https://${hostName}/xray/${userID}#${encodedSubName}`;
  const subSbUrl = `https://${hostName}/sb/${userID}?name=${encodedSubName}`;

  try {
    let finalHTML = panelHtml
      .replace(/{{PROXY_ADDRESS}}/g, proxyAddress || hostName)
      .replace(/{{CONFIG_DREAM}}/g, dream)
      .replace(/{{CONFIG_FREEDOM}}/g, freedom)
      .replace(
        /{{URL_HIDDIFY}}/g,
        `hiddify://install-config?url=${encodeURIComponent(subXrayUrlH)}`,
      )
      .replace(/{{URL_V2RAYNG}}/g, `v2rayng://install-config?url=${subXrayUrlV}`)
      .replace(
        /{{URL_EXCLAVE}}/g,
        `sn://subscription?url=${encodeURIComponent(subSbUrl)}&name=${encodedSubName}`,
      );

    return new Response(finalHTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    return new Response("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      const cfg = Config.fromEnv(env);
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
        await ensureWasm();

        const requestConfig = {
          userID: cfg.userID,
          proxyIP: cfg.proxyIP,
          proxyPort: cfg.proxyPort,
          proxyList: cfg.proxyList,
        };
        return await ProtocolOverWSHandler(request, requestConfig);
      }

      if (url.pathname === "/resolve-domain") {
        return await handleResolveDomain(request);
      }

      if (url.pathname === "/my-connection") {
        return await handleMyConnection(request, env, ctx);
      }

      if (cfg.userIDs.length > 0) {
        const matchedID = cfg.userIDs.find(
          (id) =>
            url.pathname === `/${id}` ||
            url.pathname.startsWith(`/${id}/`) ||
            url.pathname.startsWith(`/xray/${id}`) ||
            url.pathname.startsWith(`/sb/${id}`),
        );

        if (matchedID) {
          if (url.pathname.startsWith(`/xray/${matchedID}`)) {
            return await handleIpSubscription(request, "xray", matchedID, url.hostname, ctx, env);
          }
          if (url.pathname.startsWith(`/sb/${matchedID}`)) {
            return await handleIpSubscription(request, "sb", matchedID, url.hostname, ctx, env);
          }
          if (url.pathname === `/${matchedID}` || url.pathname.startsWith(`/${matchedID}/`)) {
            return await handleConfigPage(matchedID, url.hostname, cfg.proxyAddress);
          }
        }
      }

      return createDecoyResponse();
    } catch (err) {
      console.error("Worker request error:", err?.stack || err);
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
