'use strict'
const LRU = require('lru-cache')
const url = require('url')

let AGENT_CACHE = new LRU({ max: 50 })
let HttpsAgent
let HttpAgent

module.exports = getAgent

function getAgent (uri, opts) {
  const parsedUri = url.parse(typeof uri === 'string' ? uri : uri.url)
  const isHttps = parsedUri.protocol === 'https:'
  const pxuri = getProxyUri(uri, opts)

  const key = [
    `https:${isHttps}`,
    pxuri
    ? `proxy:${pxuri.protocol}//${pxuri.host}:${pxuri.port}`
    : '>no-proxy<',
    `local-address:${opts.localAddress || '>no-local-address<'}`,
    `strict-ssl:${isHttps ? !!opts.strictSSL : '>no-strict-ssl<'}`,
    `ca:${(isHttps && opts.ca) || '>no-ca<'}`,
    `cert:${(isHttps && opts.cert) || '>no-cert<'}`,
    `key:${(isHttps && opts.key) || '>no-key<'}`
  ].join(':')

  if (opts.agent != null) { // `agent: false` has special behavior!
    return opts.agent
  }

  if (AGENT_CACHE.peek(key)) {
    return AGENT_CACHE.get(key)
  }

  if (pxuri) {
    const proxy = getProxy(pxuri, opts)
    AGENT_CACHE.set(key, proxy)
    return proxy
  }

  if (isHttps && !HttpsAgent) {
    HttpsAgent = require('agentkeepalive').HttpsAgent
  } else if (!isHttps && !HttpAgent) {
    HttpAgent = require('agentkeepalive')
  }
  const agent = isHttps ? new HttpsAgent({
    maxSockets: opts.maxSockets || 15,
    ca: opts.ca,
    cert: opts.cert,
    key: opts.key,
    localAddress: opts.localAddress,
    rejectUnauthorized: opts.strictSSL
  }) : new HttpAgent({
    maxSockets: opts.maxSockets || 15,
    localAddress: opts.localAddress
  })
  AGENT_CACHE.set(key, agent)
  return agent
}

function checkNoProxy (uri, opts) {
  const host = url.parse(uri).hostname.split('.').reverse()
  let noproxy = (opts.noProxy || getProcessEnv('no_proxy'))
  if (typeof noproxy === 'string') {
    noproxy = noproxy.split(/\s*,\s*/g)
  }
  return noproxy && noproxy.some(no => {
    const noParts = no.split('.').filter(x => x).reverse()
    if (!noParts.length) { return false }
    for (let i = 0; i < noParts.length; i++) {
      if (host[i] !== noParts[i]) {
        return false
      }
    }
    return true
  })
}

module.exports.getProcessEnv = getProcessEnv

function getProcessEnv (env) {
  if (!env) { return }

  let value

  if (Array.isArray(env)) {
    for (let e of env) {
      value = process.env[e] ||
        process.env[e.toUpperCase()] ||
        process.env[e.toLowerCase()]
      if (typeof value !== 'undefined') { break }
    }
  }

  if (typeof env === 'string') {
    value = process.env[env] ||
      process.env[env.toUpperCase()] ||
      process.env[env.toLowerCase()]
  }

  return value
}

function getProxyUri (uri, opts) {
  const protocol = url.parse(uri).protocol

  const proxy = opts.proxy || (
    protocol === 'https:' && getProcessEnv('https_proxy')
  ) || (
    protocol === 'http:' && getProcessEnv(['https_proxy', 'http_proxy', 'proxy'])
  )
  if (!proxy) { return null }

  const parsedProxy = (typeof proxy === 'string') ? url.parse(proxy) : proxy

  return !checkNoProxy(uri, opts) && parsedProxy
}

let HttpProxyAgent
let HttpsProxyAgent
let SocksProxyAgent
function getProxy (proxyUrl, opts) {
  let popts = {
    host: proxyUrl.hostname,
    port: proxyUrl.port,
    protocol: proxyUrl.protocol,
    path: proxyUrl.path,
    ca: opts.ca,
    cert: opts.cert,
    key: opts.key,
    localAddress: opts.localAddress,
    maxSockets: opts.maxSockets || 15,
    rejectUnauthorized: opts.strictSSL
  }

  if (proxyUrl.protocol === 'http:') {
    if (!HttpProxyAgent) {
      HttpProxyAgent = require('http-proxy-agent')
    }

    return new HttpProxyAgent(popts)
  }
  if (proxyUrl.protocol === 'https:') {
    if (!HttpsProxyAgent) {
      HttpsProxyAgent = require('https-proxy-agent')
    }

    return new HttpsProxyAgent(popts)
  }
  if (proxyUrl.startsWith('socks')) {
    if (!SocksProxyAgent) {
      SocksProxyAgent = require('socks-proxy-agent')
    }

    return new SocksProxyAgent(popts)
  }
}
