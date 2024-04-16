import { IENV, getEnv } from "./env"

const overrideLocalDev = false

export let PROD_DOMAIN = "https://www.refly.ai"
export let DEV_DOMAIN = "https://production-test.refly.ai"

export let SERVER_PROD_DOMAIN = "https://api.refly.ai"
export let SERVER_DEV_DOMAIN = "http://localhost:3000"

export let CLIENT_PROD_DOMAIN = "https://www.refly.ai"
export let CLIENT_DEV_DOMAIN = "http://localhost:5173"

export let SERVERLESS_WORKER_DEV_DOMAIN = "http://localhost:8787"
export let SERVERLESS_WORKER_PROD_DOMAIN = "https://api.refly.ai" // TODO：这里需要更换成实际的 worker 地址

export const getServerOrigin = () => {
  // return PROD_DOMAIN
  if (overrideLocalDev) {
    return "http://localhost:3000"
  }
  return getEnv() === IENV.DEVELOPMENT ? SERVER_DEV_DOMAIN : SERVER_PROD_DOMAIN
}

export const getClientOrigin = () => {
  if (overrideLocalDev) {
    return "http://localhost:5173"
  }
  return getEnv() === IENV.DEVELOPMENT ? CLIENT_DEV_DOMAIN : CLIENT_PROD_DOMAIN
}

export function getExtensionUrl(url) {
  return chrome.runtime.getURL(url)
}

export const getServerlessWorkOrigin = () => {
  if (overrideLocalDev) {
    return "http://localhost:8787"
  }

  return getEnv() === IENV.DEVELOPMENT
    ? SERVERLESS_WORKER_DEV_DOMAIN
    : SERVERLESS_WORKER_PROD_DOMAIN
}
